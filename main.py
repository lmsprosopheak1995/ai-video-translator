"""
DubMaster backend: Khmer TTS (Edge-TTS) + FFmpeg mix.
Run:  uvicorn main:app --port 8001
Needs ffmpeg + ffprobe on PATH.
"""
import asyncio
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import edge_tts
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

app = FastAPI(title="DubMaster Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

VOICES = {
    "km-male": "km-KH-PisethNeural",
    "km-female": "km-KH-SreymomNeural",
    "en-male": "en-US-GuyNeural",
    "en-female": "en-US-JennyNeural",
    "th-female": "th-TH-PremwadeeNeural",
    "zh-female": "zh-CN-XiaoxiaoNeural",
}
MAX_SPEEDUP = 1.5      # ល្បឿនអតិបរមាពេលសំឡេងវែងជាងចន្លោះ
BG_VOLUME = 0.15       # កម្រិតសំឡេងដើមពេលរក្សាទុក


def run(cmd: list[str]) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "")[-800:])
    return r.stdout


def duration(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "csv=p=0", str(path)])
    return float(out.strip() or 0)


def has_audio(path: Path) -> bool:
    out = run(["ffprobe", "-v", "error", "-select_streams", "a",
               "-show_entries", "stream=index", "-of", "csv=p=0", str(path)])
    return bool(out.strip())


@app.get("/api/health")
def health():
    return {"ok": True, "ffmpeg": shutil.which("ffmpeg") is not None}


@app.post("/api/dub")
async def dub(
    video: UploadFile = File(...),
    segments: str = Form(...),
    voice: str = Form("km-female"),
    keep_original: bool = Form(True),
):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise HTTPException(500, "មិនឃើញ ffmpeg/ffprobe ក្នុង PATH")
    try:
        segs = [s for s in json.loads(segments) if str(s.get("text", "")).strip()]
    except Exception:
        raise HTTPException(400, "segments មិនមែន JSON ត្រឹមត្រូវ")
    if not segs:
        raise HTTPException(400, "គ្មានចំណងជើងរង")

    voice_name = VOICES.get(voice, voice)
    tmp = Path(tempfile.mkdtemp(prefix="dub_"))
    cleanup = BackgroundTask(shutil.rmtree, tmp, True)
    try:
        src = tmp / "input_video"
        with open(src, "wb") as f:
            while chunk := await video.read(1024 * 1024):
                f.write(chunk)

        # 1) បង្កើតសំឡេង TTS ម្ដងមួយបន្ទាត់
        clips = []
        for i, s in enumerate(segs):
            mp3 = tmp / f"seg{i}.mp3"
            await edge_tts.Communicate(str(s["text"]), voice_name).save(str(mp3))
            clips.append(mp3)

        # 2) ប៉ាន់ល្បឿន ហើយបង្កើត filter graph
        lines, labels = [], []
        for i, (s, mp3) in enumerate(zip(segs, clips)):
            start = max(0.0, float(s["start"]))
            slot = max(0.3, float(s["end"]) - start)
            dur = await asyncio.to_thread(duration, mp3)
            rate = min(max(dur / slot, 1.0), MAX_SPEEDUP)
            delay = int(start * 1000)
            lines.append(
                f"[{i + 1}:a]aformat=sample_rates=44100:channel_layouts=stereo,"
                f"atempo={rate:.3f},adelay={delay}|{delay}[a{i}]"
            )
            labels.append(f"[a{i}]")
        lines.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:dropout_transition=0[dub]")

        use_bg = keep_original and await asyncio.to_thread(has_audio, src)
        if use_bg:
            lines.append(f"[0:a]volume={BG_VOLUME}[bg]")
            lines.append("[bg][dub]amix=inputs=2:normalize=0:duration=first[out]")
        else:
            lines.append("[dub]anull[out]")

        script = tmp / "filter.txt"
        script.write_text(";\n".join(lines), encoding="utf-8")

        # 3) Mix + mux (វីដេអូមិន re-encode)
        out = tmp / "output.mp4"
        cmd = ["ffmpeg", "-y", "-i", str(src)]
        for c in clips:
            cmd += ["-i", str(c)]
        cmd += ["-filter_complex_script", str(script), "-map", "0:v:0", "-map", "[out]",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", str(out)]
        await asyncio.to_thread(run, cmd)

        return FileResponse(out, media_type="video/mp4", filename="dubbed.mp4", background=cleanup)
    except HTTPException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(500, f"បរាជ័យ: {e}")
