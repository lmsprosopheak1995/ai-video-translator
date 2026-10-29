1) winget install Gyan.FFmpeg      (បន្ទាប់មកបើក terminal ថ្មី; ពិនិត្យ: ffmpeg -version)
2) cd backend
   py -3.12 -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt
3) uvicorn main:app --port 8001
4) បើក index.html -> Settings & API -> Backend URL = http://127.0.0.1:8001
