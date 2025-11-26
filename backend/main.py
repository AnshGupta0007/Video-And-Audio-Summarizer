# main.py — Protected v7 (final)
import os
import re
import shutil
import subprocess
import uuid
import logging
from typing import Optional

from fastapi import (
    FastAPI,
    File,
    UploadFile,
    HTTPException,
    Form,
    Header,
    Depends,
    Request,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from openai import OpenAI
from langdetect import detect
from gtts import gTTS
import yt_dlp

# -------------------------
# Logging
# -------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("media-processor-v7")

# -------------------------
# App + CORS
# -------------------------
app = FastAPI(title="Media Processor API (v7 - Protected)")

ALLOWED_ORIGINS = [
    "https://video-and-audio-summarizer.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------
# Security
# -------------------------
API_SECRET = os.getenv("API_SECRET")  # must set this in Render/Vercel env

def require_key(request: Request, x_api_key: Optional[str] = Header(None)):
    """
    Allow OPTIONS through without key (preflight).
    For other methods, require x-api-key == API_SECRET.
    """
    if request.method == "OPTIONS":
        # Let CORS preflight pass
        return

    if API_SECRET is None:
        logger.error("API_SECRET not configured")
        raise HTTPException(500, "Server misconfigured (API_SECRET missing)")

    if x_api_key != API_SECRET:
        raise HTTPException(401, "Invalid or missing API key")

# -------------------------
# OpenAI client
# -------------------------
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_KEY) if OPENAI_KEY else None

# -------------------------
# Storage folders
# -------------------------
os.makedirs("uploads", exist_ok=True)
os.makedirs("outputs", exist_ok=True)

# -------------------------
# Pydantic DTOs
# -------------------------
class VideoFile(BaseModel):
    video_file: str

class AudioFile(BaseModel):
    audio_file: str

class TextFile(BaseModel):
    text_file: str

class YouTubeURL(BaseModel):
    url: str

class SummaryFile(BaseModel):
    summary_file: str

# -------------------------
# Helpers
# -------------------------
def run_ffmpeg(cmd):
    subprocess.run(cmd, check=True)

def extract_audio_from_video(video_path: str, out_mp3: str):
    run_ffmpeg(["ffmpeg", "-y", "-i", video_path, "-vn", out_mp3])
    return out_mp3

def whisper_transcribe(path: str, language: Optional[str] = None) -> str:
    if client is None:
        raise HTTPException(500, "OpenAI not configured (OPENAI_API_KEY missing)")

    with open(path, "rb") as f:
        args = {"model": "whisper-1", "file": f}
        if language:
            args["language"] = language
        res = client.audio.transcriptions.create(**args)
        return res.text

def extract_video_id(url: str) -> Optional[str]:
    patterns = [
        r"[?&]v=([A-Za-z0-9_-]{6,})",
        r"youtu\.be/([A-Za-z0-9_-]{6,})",
        r"shorts/([A-Za-z0-9_-]{6,})",
        r"embed/([A-Za-z0-9_-]{6,})",
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    last = url.rstrip("/").split("/")[-1]
    if len(last) >= 6:
        return last
    return None

def extract_youtube_audio_and_transcript(url: str, out_text: str) -> str:
    vid = extract_video_id(url)
    if not vid:
        raise HTTPException(400, "Invalid YouTube URL")
    uid = uuid.uuid4().hex
    base = f"uploads/{uid}"
    # Save audio to base + .mp3
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": base,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "quiet": True,
        "no_warnings": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as e:
        logger.exception("yt_dlp failed")
        raise HTTPException(500, f"yt_dlp error: {e}")

    audio_path = base + ".mp3"
    if not os.path.exists(audio_path):
        # sometimes output has extension appended
        if os.path.exists(base):
            audio_path = base
        else:
            raise HTTPException(500, "Failed to download audio")

    # Transcribe with Whisper
    try:
        transcript = whisper_transcribe(audio_path)
    finally:
        # remove audio to save disk
        try:
            os.remove(audio_path)
        except Exception:
            pass

    open(out_text, "w", encoding="utf-8").write(transcript)
    return out_text

def summarize_text_minimal(path: str, out: str, target_lang: Optional[str] = None) -> str:
    """
    Use OpenAI chat completions to return the minimal summary preserving full context.
    target_lang: if 'en' forces English summary, otherwise same-language summary.
    """
    text = open(path, "r", encoding="utf-8").read()
    if not text.strip():
        s = ""
        open(out, "w", encoding="utf-8").write(s)
        return s

    if client is None:
        raise HTTPException(500, "OpenAI not configured")

    system_prompt = (
        "Summarize the following text using the **fewest possible words** while preserving "
        "all essential meaning and context. Produce the minimal, precise summary. "
    )
    if target_lang == "en":
        system_prompt += "Output must be in English."
    else:
        system_prompt += "Output must be in the same language as the input."

    res = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text},
        ],
        temperature=0.1,
        max_tokens=500,
    )
    summary = res.choices[0].message.content.strip()
    open(out, "w", encoding="utf-8").write(summary)
    return summary

def tts_save(path: str, out_mp3: str, force_lang: Optional[str] = None) -> str:
    text = open(path, "r", encoding="utf-8").read()
    if not text.strip():
        raise HTTPException(400, "Empty summary for TTS")
    lang = "en"
    if force_lang:
        lang = force_lang
    else:
        try:
            lang = detect(text)
        except Exception:
            lang = "en"
    gTTS(text=text, lang=lang, slow=False).save(out_mp3)
    return out_mp3

def make_fast_audio(in_mp3: str, out_mp3: str) -> str:
    run_ffmpeg(["ffmpeg", "-y", "-i", in_mp3, "-filter:a", "atempo=1.5", out_mp3])
    return out_mp3

# -------------------------
# OPTIONS handler (safe)
# -------------------------
@app.options("/{path:path}", include_in_schema=False)
async def global_options(path: str, request: Request):
    # Return empty 200 so preflight succeeds (CORS middleware will add headers)
    return JSONResponse(content={"ok": True})

# -------------------------
# Endpoints (each checks API key via Depends(require_key))
# -------------------------

@app.post("/upload-audio")
async def upload_audio(request: Request, auth=Depends(require_key), file: UploadFile = File(...)):
    dest = f"uploads/{file.filename}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"filename": dest}

@app.post("/upload-video")
async def upload_video(request: Request, auth=Depends(require_key), file: UploadFile = File(...)):
    dest = f"uploads/{file.filename}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"filename": dest}

@app.post("/upload-text")
async def upload_text(request: Request, auth=Depends(require_key), file: UploadFile = File(None), text: str = Form(None)):
    if file:
        dest = f"uploads/{file.filename}"
        with open(dest, "wb") as f:
            shutil.copyfileobj(file.file, f)
        return {"text_file": dest}
    if text:
        uid = uuid.uuid4().hex
        dest = f"uploads/{uid}.txt"
        open(dest, "w", encoding="utf-8").write(text)
        return {"text_file": dest}
    raise HTTPException(400, "Please provide a file or text")

@app.post("/extract-audio")
async def extract_audio_endpoint(request: Request, auth=Depends(require_key), data: VideoFile = None):
    # expects {"video_file": "uploads/xyz.mp4"}
    if not data or not data.video_file:
        raise HTTPException(400, "Missing video_file")
    out = f"outputs/audio_{uuid.uuid4().hex}.mp3"
    extract_audio_from_video(data.video_file, out)
    return {"audio_file": out}

@app.post("/transcribe-native")
async def transcribe_native(request: Request, auth=Depends(require_key), data: AudioFile = None):
    if not data or not data.audio_file:
        raise HTTPException(400, "Missing audio_file")
    out = f"outputs/native_{uuid.uuid4().hex}.txt"
    txt = whisper_transcribe(data.audio_file)
    open(out, "w", encoding="utf-8").write(txt)
    return {"text_file": out, "transcription": txt}

@app.post("/transcribe-english")
async def transcribe_english(request: Request, auth=Depends(require_key), data: AudioFile = None):
    if not data or not data.audio_file:
        raise HTTPException(400, "Missing audio_file")
    out = f"outputs/english_{uuid.uuid4().hex}.txt"
    txt = whisper_transcribe(data.audio_file, language="en")
    open(out, "w", encoding="utf-8").write(txt)
    return {"text_file": out, "transcription": txt}

@app.post("/youtube-subtitles")
async def youtube_subtitles(request: Request, auth=Depends(require_key), data: YouTubeURL = None):
    if not data or not data.url:
        raise HTTPException(400, "Missing url")
    out = f"uploads/youtube_{uuid.uuid4().hex}.txt"
    extract_youtube_audio_and_transcript(data.url, out)
    return {"text_file": out}

@app.post("/summarize-native")
async def summarize_native_ep(request: Request, auth=Depends(require_key), text_file: str = Form(...)):
    if not os.path.exists(text_file):
        raise HTTPException(404, "text_file not found")
    out = f"outputs/sum_native_{uuid.uuid4().hex}.txt"
    s = summarize_text_minimal(text_file, out, target_lang=None)
    return {"summary_file": out, "summary": s}

@app.post("/summarize-english")
async def summarize_english_ep(request: Request, auth=Depends(require_key), text_file: str = Form(...)):
    if not os.path.exists(text_file):
        raise HTTPException(404, "text_file not found")
    out = f"outputs/sum_eng_{uuid.uuid4().hex}.txt"
    s = summarize_text_minimal(text_file, out, target_lang="en")
    return {"summary_file": out, "summary": s}

@app.post("/tts-native")
async def tts_native_ep(request: Request, auth=Depends(require_key), data: SummaryFile = None):
    if not data or not data.summary_file:
        raise HTTPException(400, "Missing summary_file")
    out = f"outputs/audio_native_{uuid.uuid4().hex}.mp3"
    tts_save(data.summary_file, out, force_lang=None)
    return {"audio_file": out}

@app.post("/tts-english")
async def tts_english_ep(request: Request, auth=Depends(require_key), data: SummaryFile = None):
    if not data or not data.summary_file:
        raise HTTPException(400, "Missing summary_file")
    out = f"outputs/audio_english_{uuid.uuid4().hex}.mp3"
    tts_save(data.summary_file, out, force_lang="en")
    return {"audio_file": out}

@app.post("/fast-native")
async def fast_native_ep(request: Request, auth=Depends(require_key), data: AudioFile = None):
    if not data or not data.audio_file:
        raise HTTPException(400, "Missing audio_file")
    out = f"outputs/fast_native_{uuid.uuid4().hex}.mp3"
    make_fast_audio(data.audio_file, out)
    return {"fast_audio_file": out}

@app.post("/fast-english")
async def fast_english_ep(request: Request, auth=Depends(require_key), data: AudioFile = None):
    if not data or not data.audio_file:
        raise HTTPException(400, "Missing audio_file")
    out = f"outputs/fast_english_{uuid.uuid4().hex}.mp3"
    make_fast_audio(data.audio_file, out)
    return {"fast_audio_file": out}

@app.get("/files/{path:path}")
async def get_file(request: Request, auth=Depends(require_key), path: str = ""):
    if not os.path.exists(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path)

@app.get("/")
async def root():
    return {"status": "media-processor-v7", "secure": True}

# -------------------------
# Run
# -------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)
