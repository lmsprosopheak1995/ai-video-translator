# AI DubMaster Pro

ឧបករណ៍បកប្រែវីដេអូ និងដាក់សំឡេងថ្មី (Dubbing) ដោយ AI ដែលគាំទ្រភាសាខ្មែរ។

## មុខងារ

- ផ្ទុកវីដេអូឡើង (Drag & Drop ឬចុចជ្រើសរើស)
- ស្តាប់ និងបកប្រែសំឡេងជាចំណងជើងរង តាម Gemini API
- កែអត្ថបទក្នុងតារាង ហើយ Export ជា `.srt`
- បង្កើតសំឡេងខ្មែរ (Edge-TTS) ហើយរួមជាមួយវីដេអូដោយ FFmpeg
- Settings & API និង History (រក្សាទុកក្នុង browser)

## តម្រូវការ

- Windows + Python 3.12
- [FFmpeg](https://ffmpeg.org/) (ត្រូវមានក្នុង PATH)
- Gemini API Key ពី https://aistudio.google.com/apikey

## របៀបដំឡើង

**1. ដំឡើង FFmpeg** (រួចបើក terminal ថ្មី)

```
winget install Gyan.FFmpeg
ffmpeg -version
```

**2. ដំឡើង Backend**

```
cd backend
py -3.12 -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

**3. ដំណើរការ Backend**

```
uvicorn main:app --port 8001
```

**4. បើក Frontend**

បើកឯកសារ `index.html` ក្នុង browser រួចចូល **Settings & API**៖

- បញ្ចូល Gemini API Key
- Backend URL = `http://127.0.0.1:8001`

## ដែនកំណត់

- វីដេអូសម្រាប់បកប្រែត្រូវតូចជាង ~18MB (ការបញ្ជូនផ្ទាល់ទៅ Gemini)
- Timestamp ពី AI អាចលម្អៀង ត្រូវពិនិត្យតារាងមុន Export
- API Key រក្សាក្នុង browser ប៉ុណ្ណោះ មិនត្រូវ commit ចូលកូដទេ

## រចនាសម្ព័ន្ធ

```
├── index.html
├── script.js
├── style.css
└── backend/
    ├── main.py
    └── requirements.txt
```
