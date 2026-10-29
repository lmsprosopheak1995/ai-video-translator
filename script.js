/**
 * AI DubMaster Pro - ស្គ្រីបចម្បង
 * ផ្នែក: Upload, Settings, History, បកប្រែតាម Gemini API, SRT, TTS
 */

const MAX_SIZE = 500 * 1024 * 1024;        // ដែនកំណត់ upload (500MB)
const MAX_INLINE = 18 * 1024 * 1024;       // Gemini inline limit (~20MB)
const LS_SETTINGS = 'dubmaster_settings';
const LS_HISTORY = 'dubmaster_history';

const state = { file: null, segments: [], url: null };

const $ = (id) => document.getElementById(id);

/* ---------- Storage ---------- */
function loadSettings() {
    try {
        return Object.assign(
            { apiKey: '', model: 'gemini-2.5-flash', voiceLang: 'km-KH', backend: 'http://127.0.0.1:8001' },
            JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}')
        );
    } catch { return { apiKey: '', model: 'gemini-2.5-flash', voiceLang: 'km-KH', backend: 'http://127.0.0.1:8001' }; }
}
function saveSettings(s) { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); }
function loadHistory() {
    try { return JSON.parse(localStorage.getItem(LS_HISTORY) || '[]'); } catch { return []; }
}
function saveHistory(list) { localStorage.setItem(LS_HISTORY, JSON.stringify(list)); }

/* ---------- Helpers ---------- */
function setStatus(msg, type = 'info') {
    const el = $('status');
    el.textContent = msg;
    el.className = 'status ' + type;
    el.classList.toggle('hidden', !msg);
}
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function srtTime(sec) {
    const ms = Math.round(sec * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000),
          s = Math.floor(ms % 60000 / 1000), r = ms % 1000;
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(r, 3)}`;
}
function shortTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${pad(m)}:${pad(s)}`;
}
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(',')[1]);
        r.onerror = () => reject(new Error('មិនអាចអានឯកសារបាន'));
        r.readAsDataURL(file);
    });
}

/* ---------- Gemini translate ---------- */
async function translateVideo(file, sourceLang, targetLang) {
    const s = loadSettings();
    if (!s.apiKey) throw new Error('សូមបញ្ចូល API Key នៅ Settings & API ជាមុនសិន');
    if (file.size > MAX_INLINE) {
        throw new Error('ឯកសារធំជាង ~18MB។ សូមកាត់ ឬបង្ហាប់វីដេអូជាមុនសិន (ឬបន្ថែម backend សម្រាប់ឯកសារធំ)');
    }

    const base64 = await fileToBase64(file);
    const srcText = sourceLang === 'auto' ? 'the spoken language (auto-detect)' : sourceLang;
    const prompt =
        `Listen to the speech in this video (${srcText}). Transcribe it into short subtitle segments ` +
        `and translate each segment into natural ${targetLang}. ` +
        `Return ONLY a JSON array. Each item: {"start": number (seconds), "end": number (seconds), "text": string (translated)}. ` +
        `Segments must be in order, not overlapping, each under 7 seconds.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.apiKey },
        body: JSON.stringify({
            contents: [{ parts: [
                { inline_data: { mime_type: file.type || 'video/mp4', data: base64 } },
                { text: prompt }
            ] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
        })
    });

    if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).error?.message || ''; } catch {}
        throw new Error(`API error ${res.status}: ${detail}`);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    const clean = text.replace(/```json|```/g, '').trim();
    let arr;
    try { arr = JSON.parse(clean); } catch { throw new Error('លទ្ធផលពី AI មិនមែនជា JSON ត្រឹមត្រូវ សូមសាកល្បងម្ដងទៀត'); }
    if (!Array.isArray(arr)) throw new Error('ទម្រង់លទ្ធផលមិនត្រឹមត្រូវ');

    return arr
        .map(x => ({ start: Number(x.start) || 0, end: Number(x.end) || 0, text: String(x.text || '').trim() }))
        .filter(x => x.text && x.end > x.start);
}

/* ---------- Subtitles UI ---------- */
function renderSegments() {
    const body = $('subs-body');
    body.innerHTML = '';
    state.segments.forEach((seg, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML =
            `<td>${i + 1}</td><td>${shortTime(seg.start)}</td><td>${shortTime(seg.end)}</td>` +
            `<td><input class="sub-input" data-i="${i}" value="${escapeHtml(seg.text)}"></td>`;
        tr.addEventListener('click', () => { $('video-preview').currentTime = seg.start; });
        body.appendChild(tr);
    });
    body.querySelectorAll('.sub-input').forEach(inp => {
        inp.addEventListener('click', e => e.stopPropagation());
        inp.addEventListener('input', e => { state.segments[+e.target.dataset.i].text = e.target.value; });
    });
    $('subs-panel').classList.toggle('hidden', state.segments.length === 0);
}

function exportSRT() {
    if (!state.segments.length) return;
    const srt = state.segments.map((s, i) =>
        `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`).join('\n');
    const blob = new Blob(['\ufeff' + srt], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.file?.name.replace(/\.[^.]+$/, '') || 'subtitle') + '.srt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- TTS (Browser) ---------- */
function speakAll() {
    if (!('speechSynthesis' in window)) { alert('Browser នេះមិនគាំទ្រ TTS'); return; }
    const lang = loadSettings().voiceLang || 'km-KH';
    const video = $('video-preview');
    window.speechSynthesis.cancel();
    video.currentTime = 0;
    video.muted = true;
    video.play();
    let spoken = -1;
    const onTime = () => {
        const i = state.segments.findIndex(s => video.currentTime >= s.start && video.currentTime < s.end);
        if (i !== -1 && i !== spoken) {
            spoken = i;
            const u = new SpeechSynthesisUtterance(state.segments[i].text);
            u.lang = lang;
            window.speechSynthesis.speak(u);
        }
    };
    const stop = () => {
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('pause', stop);
        video.muted = false;
        window.speechSynthesis.cancel();
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('pause', stop);
}

/* ---------- Dub (backend: Edge-TTS + FFmpeg) ---------- */
async function dubVideo() {
    if (!state.file || !state.segments.length) return;
    const btn = $('btn-dub');
    const backend = loadSettings().backend;
    btn.disabled = true;
    setStatus('កំពុងបង្កើតសំឡេង និងរួមជាមួយវីដេអូ... (រង់ចាំមួយសន្ទុះ)', 'info');
    try {
        const fd = new FormData();
        fd.append('video', state.file);
        fd.append('segments', JSON.stringify(state.segments));
        fd.append('voice', $('dub-voice').value);
        fd.append('keep_original', $('dub-keep').checked ? 'true' : 'false');

        let res;
        try {
            res = await fetch(`${backend}/api/dub`, { method: 'POST', body: fd });
        } catch {
            throw new Error(`ភ្ជាប់ Backend មិនបាន (${backend}) សូមពិនិត្យថា uvicorn កំពុងដំណើរការ`);
        }
        if (!res.ok) {
            let d = '';
            try { d = (await res.json()).detail || ''; } catch {}
            throw new Error(`Backend error ${res.status}: ${d}`);
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (state.file.name.replace(/\.[^.]+$/, '') || 'video') + '_dubbed.mp4';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        setStatus('បង្កើតវីដេអូដាក់សំឡេងរួចរាល់! (កំពុងទាញយក)', 'ok');
    } catch (err) {
        console.error(err);
        setStatus(err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

/* ---------- Modals ---------- */
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModals() { document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); }

function renderHistory() {
    const list = loadHistory();
    const box = $('history-list');
    if (!list.length) { box.innerHTML = '<p class="empty">មិនទាន់មានប្រវត្តិ</p>'; return; }
    box.innerHTML = '';
    list.forEach((h, idx) => {
        const row = document.createElement('div');
        row.className = 'history-item';
        row.innerHTML =
            `<div><strong>${escapeHtml(h.name)}</strong><br><small>${escapeHtml(h.date)} · ${escapeHtml(h.source)} → ${escapeHtml(h.target)} · ${h.segments.length} បន្ទាត់</small></div>` +
            `<div><button class="btn-secondary inline" data-act="view" data-i="${idx}">មើល</button>` +
            `<button class="btn-secondary inline" data-act="srt" data-i="${idx}">SRT</button>` +
            `<button class="btn-secondary inline" data-act="del" data-i="${idx}">លុប</button></div>`;
        box.appendChild(row);
    });
    box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const idx = +b.dataset.i;
        const item = loadHistory()[idx];
        if (!item) return;
        if (b.dataset.act === 'del') {
            const l = loadHistory(); l.splice(idx, 1); saveHistory(l); renderHistory();
        } else if (b.dataset.act === 'srt') {
            const keep = state.segments, keepFile = state.file;
            state.segments = item.segments; state.file = { name: item.name };
            exportSRT();
            state.segments = keep; state.file = keepFile;
        } else {
            if (!state.file) { alert('សូមបើកវីដេអូដូចគ្នាជាមុនសិន ដើម្បីមើលជាមួយចំណងជើងរង'); return; }
            state.segments = item.segments; renderSegments(); closeModals();
        }
    }));
}

function addHistory(entry) {
    const list = loadHistory();
    list.unshift(entry);
    saveHistory(list.slice(0, 30)); // រក្សាត្រឹម 30
}

/* ---------- Upload ---------- */
function initVideoUpload() {
    const fileInput = $('video-file-input');
    const uploadBox = $('upload-box');
    const studioBox = $('studio-box');
    const video = $('video-preview');

    function handleFile(file) {
        if (!file) return;
        if (!file.type.startsWith('video/')) { alert('សូមជ្រើសរើសឯកសារវីដេអូប៉ុណ្ណោះ!'); return; }
        if (file.size > MAX_SIZE) { alert('ឯកសារធំជាង 500MB!'); return; }
        if (state.url) URL.revokeObjectURL(state.url);
        state.file = file;
        state.segments = [];
        state.url = URL.createObjectURL(file);
        video.src = state.url;
        renderSegments();
        setStatus('');
        uploadBox.classList.add('hidden');
        studioBox.classList.remove('hidden');
    }

    uploadBox.addEventListener('click', () => fileInput.click());
    $('btn-choose').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    ['dragenter', 'dragover'].forEach(ev => uploadBox.addEventListener(ev, (e) => {
        e.preventDefault(); uploadBox.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach(ev => uploadBox.addEventListener(ev, (e) => {
        e.preventDefault(); uploadBox.classList.remove('dragover');
    }));
    uploadBox.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

    $('btn-change-video').addEventListener('click', () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
        if (state.url) URL.revokeObjectURL(state.url);
        state.url = null; state.file = null; state.segments = [];
        fileInput.value = '';
        $('subtitle-overlay').textContent = '';
        studioBox.classList.add('hidden');
        uploadBox.classList.remove('hidden');
    });

    // បង្ហាញចំណងជើងរងលើវីដេអូ
    video.addEventListener('timeupdate', () => {
        const t = video.currentTime;
        const seg = state.segments.find(s => t >= s.start && t < s.end);
        $('subtitle-overlay').textContent = seg ? seg.text : '';
    });
}

function initProcess() {
    const btn = $('btn-start-process');
    btn.addEventListener('click', async () => {
        const source = $('source-lang').value;
        const target = $('target-lang').value;
        if (source === target) { alert('ភាសាដើម និងភាសាគោលដៅត្រូវតែខុសគ្នា!'); return; }
        if (!state.file) return;

        btn.disabled = true;
        setStatus('កំពុងបកប្រែ... (អាចចំណាយពេលមួយសន្ទុះ)', 'info');
        try {
            state.segments = await translateVideo(state.file, source, target);
            if (!state.segments.length) throw new Error('រកមិនឃើញសំឡេងនិយាយក្នុងវីដេអូ');
            renderSegments();
            addHistory({
                name: state.file.name, source, target,
                date: new Date().toLocaleString(), segments: state.segments
            });
            setStatus(`បកប្រែរួចរាល់ (${state.segments.length} បន្ទាត់)`, 'ok');
        } catch (err) {
            console.error(err);
            setStatus(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    });
    $('btn-export-srt').addEventListener('click', exportSRT);
    $('btn-speak-all').addEventListener('click', speakAll);
    $('btn-dub').addEventListener('click', dubVideo);
}

function initNav() {
    document.querySelectorAll('.nav-menu a').forEach(a => a.addEventListener('click', e => e.preventDefault()));
    $('btn-studio').addEventListener('click', closeModals);

    $('btn-settings').addEventListener('click', () => {
        const s = loadSettings();
        $('set-apikey').value = s.apiKey;
        $('set-model').value = s.model;
        $('set-voicelang').value = s.voiceLang;
        $('set-backend').value = s.backend;
        openModal('modal-settings');
    });
    $('btn-history').addEventListener('click', () => { renderHistory(); openModal('modal-history'); });

    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModals));
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });

    $('btn-save-settings').addEventListener('click', () => {
        saveSettings({
            apiKey: $('set-apikey').value.trim(),
            model: $('set-model').value.trim() || 'gemini-2.5-flash',
            voiceLang: $('set-voicelang').value.trim() || 'km-KH',
            backend: ($('set-backend').value.trim() || 'http://127.0.0.1:8001').replace(/\/+$/, '')
        });
        closeModals();
    });
    $('btn-clear-key').addEventListener('click', () => {
        const s = loadSettings(); s.apiKey = ''; saveSettings(s); $('set-apikey').value = '';
    });
    $('btn-clear-history').addEventListener('click', () => {
        if (confirm('លុបប្រវត្តិទាំងអស់?')) { saveHistory([]); renderHistory(); }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initVideoUpload();
    initProcess();
    initNav();
});
