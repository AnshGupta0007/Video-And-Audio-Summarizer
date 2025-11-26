📌 Video & Audio Summarizer
AI-powered summarization tool that converts videos, audio files, YouTube links, or pasted text into:

✔ Accurate transcriptions (Native + English)
✔ Clean, concise summaries
✔ Audio summaries (TTS in Native + English)
✔ Fast-speed audio versions
✔ Full pipeline automation (upload → transcribe → summarize → audio)

This project uses FastAPI, React, OpenAI Whisper, GPT-4o-mini, gTTS, and yt-dlp to provide a fast and seamless media-processing workflow.

🚀 Features
🎥 Video Processing
Upload MP4 videos

Automatic audio extraction (FFmpeg)

Transcription + Summaries + TTS

🎵 Audio Processing
Upload MP3/WAV

Native transcription (auto-detected language)

English transcription

Dual summaries

TTS audio output

1.5× fast audio generation

📝 Text Summaries
Paste text or upload .txt file

Native summary

English summary

Extremely concise, context-preserving output

▶️ YouTube Summaries
Supports normal YouTube links

Shorts

youtu.be links

Extracts audio → transcribes → summarizes

🎧 Audio Outputs
Summary audio in original language

Summary audio in English

Fast versions (1.5× speed)

🌐 Frontend (React + Tailwind)
Clean UI

Drag & drop

Processing logs

8 output sections (full mode)

Reset, download, collapse/expand

🖼️ Architecture Overview
Frontend (React)
→ Uploads media
→ Shows progress logs
→ Downloads results
→ Calls backend endpoints

Backend (FastAPI)
→ Handles uploads
→ Extracts audio via FFmpeg
→ Calls Whisper for transcription
→ Calls GPT-4o-mini for summaries
→ Calls gTTS for speech output
→ Stores temporary uploads & outputs

🛠️ Tech Stack
Backend
FastAPI

OpenAI Whisper API

OpenAI GPT-4o-mini

yt-dlp

FFmpeg

gTTS

python-multipart

python-dotenv

Frontend
React

Tailwind CSS

Vite

Fetch API

📦 Folder Structure
css
Copy code
Video-Summarizer/
│
├── backend/
│   ├── main.py
│   ├── uploads/
│   ├── outputs/
│   ├── venv/
│   ├── .env
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── node_modules/
│   ├── App.js
│   └── package.json
│
└── README.md
🔧 Installation & Setup
1️⃣ Clone the repo
bash
Copy code
git clone https://github.com/<your-username>/video-summarizer.git
cd video-summarizer
🖥️ Backend Setup (FastAPI)
2️⃣ Create virtual environment
bash
Copy code
cd backend
python3 -m venv venv
source venv/bin/activate
3️⃣ Install dependencies
nginx
Copy code
pip install -r requirements.txt
4️⃣ Add your API key
Create .env:

ini
Copy code
OPENAI_API_KEY=sk-xxxx
5️⃣ Start server
nginx
Copy code
uvicorn main:app --reload --host 0.0.0.0 --port 8000
Backend will start at:

arduino
Copy code
http://localhost:8000
🌐 Frontend Setup (React)
6️⃣ Start frontend
arduino
Copy code
cd frontend
npm install
npm run dev
Frontend will run on:

arduino
Copy code
http://localhost:5173
🤝 Contributing
Pull requests are welcome!
If you want a feature added, feel free to open an issue.

📜 License
MIT License — free to use and modify.

⭐ Support
If you like this project, please star the repository ⭐
It helps others discover it and motivates further development.

