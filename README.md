📌 Video & Audio Summarizer
An AI-powered summarization tool that converts videos, audio files, YouTube links, or pasted text into:

✔ Accurate transcriptions (Native + English)
✔ Clean, concise summaries
✔ Audio summaries (TTS in Native + English)
✔ Fast-speed audio versions
✔ Fully automated workflow (upload → transcribe → summarize → audio)

This project uses FastAPI, React, Tailwind CSS, OpenAI Whisper, GPT-4o-mini, gTTS, and yt-dlp to deliver a smooth and fast media-processing pipeline.

🚀 Features
🎥 Video Processing
Upload MP4 videos

Automatic audio extraction (FFmpeg)

Native + English transcription

Dual summaries

TTS audio generation

1.5× Fast audio versions

🎵 Audio Processing
Upload MP3 / WAV

Auto language detection

Native + English transcription

Dual summaries

TTS generation

Fast audio (1.5×)

📝 Text Summaries
Paste plain text

Upload .txt files

Native summary

English summary

Ultra-concise, context-preserving output

▶️ YouTube Summaries
Supports:

Normal YouTube links

youtu.be

Shorts

Pipeline:

Extract audio → Transcribe → Summarize → Output

🎧 Audio Outputs
Summary audio (native language)

Summary audio (English)

Fast audio (1.5×) versions

Downloadable

🌐 Frontend (React + Tailwind)
Clean UI

Drag & drop upload

Processing log

Toggling output sections

Download buttons

Reset flow

Responsive layout

🖼️ Architecture Overview
Frontend (React + Vite + Tailwind)
    ↓ Upload file / paste text / submit YouTube link
    ↓ Shows progress logs
    ↓ Displays results
    ↓ Downloads files
    → Calls Backend API

Backend (FastAPI)
    ↓ Handles uploads
    ↓ Extracts audio via FFmpeg
    ↓ Transcribes using OpenAI Whisper
    ↓ Summarizes using GPT-4o-mini
    ↓ Converts summaries to speech (gTTS)
    ↓ Generates fast audio
    → Returns results to frontend

🛠️ Tech Stack
Backend
FastAPI

OpenAI Whisper API

GPT-4o-mini (OpenAI Chat Completion API)

gTTS

FFmpeg

yt-dlp

python-multipart

python-dotenv

Frontend
React

Vite

Tailwind CSS

Fetch API

📦 Folder Structure
Video-And-Audio-Summarizer/
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
│   ├── package.json
│   └── vite.config.js
│
└── README.md

🔧 Installation & Setup
1️⃣ Clone the repository
git clone https://github.com/AnshGupta0007/Video-And-Audio-Summarizer.git
cd Video-And-Audio-Summarizer

🖥️ Backend Setup (FastAPI)
2️⃣ Create a virtual environment
cd backend
python3 -m venv venv
source venv/bin/activate

3️⃣ Install Python dependencies
pip install -r requirements.txt

4️⃣ Add your API key
Create .env file inside backend/:
OPENAI_API_KEY=sk-xxxxxx


⚠️ Never commit your .env file.

5️⃣ Start backend server
bash
Copy code
uvicorn main:app --reload --host 0.0.0.0 --port 8000
Backend runs at:

arduino
Copy code
http://localhost:8000
🌐 Frontend Setup (React + Vite)
6️⃣ Install and run frontend
bash
Copy code
cd frontend
npm install
npm run dev
Frontend runs at:

arduino
Copy code
http://localhost:5173
🤝 Contributing
Contributions, issues, and feature requests are welcome!
Feel free to open an Issue or PR.

📜 License
This project is licensed under the MIT License.

⭐ Support
If you find this project useful, please star ⭐ the repository!
It helps others discover the project and motivates future improvements.

```
