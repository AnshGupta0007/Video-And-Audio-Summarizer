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
from fastapi.responses import FileResponse

from pydantic import BaseModel
from openai import OpenAI
from langdetect import detect
from gtts import gTTS
import yt_dlp


# -----------------------------------
# Logging
# -----------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("media-processor")


# -----------------------------------
# FastAPI App
# -----------------------------------
app = FastAPI(title="Media Processor API (Protected v6)")


# -----------------------------------
# CORS SETTINGS (FINAL FIXED)
# -----------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://video-and-audio-summarizer.vercel.app",
        "http://localhost:3000",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],   # allow OPTIONS, GET, POST, etc.
    allow_headers=["*"],   # allow custom headers like x-api-key
)


# -----------------------------------
# SECURITY: API KEY
# -----------------------------------
API_SECRET = os.getenv("API_SECRET")

def verify_key(request: Request, x_api_key: str = Header(None)):
    """
    ALLOW preflight OPTIONS without API key.
    Require key for all other methods.
    """

    # Browser preflight request must NOT require key
    if request.method == "OPTIONS":
        return True

    if API_SECRET is None:
        raise HTTPException(500, "Server missing API_SECRET env var")

    if x_api_key != API_SECRET:
        raise HTTPException(401, "Invalid or missing API Key")

    return True


# -----------------------------------
# FIXED UNIVERSAL OPTIONS HANDLER
# (REQUIRED FOR RENDER)
# -----------------------------------
@app.options("/{path:path}", include_in_schema=False)
async def options_handler(path: str, request: Request):
    """
    This ALWAYS returns 200 OK,
    allowing CORS preflight to succeed.
    """
    return {"status": "ok"}


# -----------------------------------
# OPENAI CLIENT
# -----------------------------------
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_KEY) if OPENAI_KEY else None

os.makedirs("uploads", exist_ok=True)
os.makedirs("outputs", exist_ok=True)


# -----------------------------------
# MODELS
# -----------------------------------
class VideoFile(BaseModel):
    video_file: str

class AudioFile(BaseModel):
    audio_file: str

class YouTubeURL(BaseModel):
    url: str

class SummaryFile(BaseModel):
    summary_file: str


# -----------------------------------
# HELPER FUNCTIONS
# -----------------------------------
def run_ffmpeg(cmd):
    subprocess.run(cmd, check=True)

def extractAudio(videoFile, outFile):
    run_ffmpeg(["ffmpeg", "-y", "-i", videoFile, "-vn", outFile])
    return outFile

def call_whisper(path, language=None):
    if client is None:
        raise HTTPException(500, "OpenAI not configured")

    with open(path, "rb") as f:
        args = {"model": "whisper-1", "file": f}
        if language:
            args["language"] = language
        r = client.audio.transcriptions.create(**args)
        return r.text

def extract_video_id(url):
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
    return last if len(last) >= 6 else None

def extract_youtube(url: str, textFile: str):
    vid = extract_video_id(url)
    if not vid:
        raise HTTPException(400, "Invalid YouTube URL")

    uid = uuid.uuid4().hex
    base = f"uploads/{uid}"
    expected = f"{base}.mp3"

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": base,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as e:
        raise HTTPException(500, str(e))

    transcript = call_whisper(expected)
    open(textFile, "w").write(transcript)
    os.remove(expected)

    return textFile

def summarize_native(path, out):
    text = open(path).read()
    r = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system",
             "content": "Summarize extremely concisely in same language."},
            {"role": "user", "content": text},
        ],
    )
    s = r.choices[0].message.content
    open(out, "w").write(s)
    return s

def summarize_english(path, out):
    text = open(path).read()
    r = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system",
             "content": "Summarize extremely concisely in English."},
            {"role": "user", "content": text},
        ],
    )
    s = r.choices[0].message.content
    open(out, "w").write(s)
    return s

def tts_native(path, out):
    text = open(path).read()
    lang = detect(text)
    gTTS(text=text, lang=lang).save(out)
    return out

def tts_english(path, out):
    text = open(path).read()
    gTTS(text=text, lang="en").save(out)
    return out

def fast_audio(inp, out):
    run_ffmpeg(["ffmpeg", "-y", "-i", inp, "-filter:a", "atempo=1.5", out])
    return out


# -----------------------------------
# ENDPOINTS (ALL PROTECTED)
# -----------------------------------
@app.post("/upload-audio", dependencies=[Depends(verify_key)])
async def upload_audio(file: UploadFile = File(...)):
    p = f"uploads/{file.filename}"
    with open(p, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"filename": p}


@app.post("/upload-text", dependencies=[Depends(verify_key)])
async def upload_text(file: UploadFile = File(None), text: str = Form(None)):
    if file:
        p = f"uploads/{file.filename}"
        with open(p, "wb") as f:
            shutil.copyfileobj(file.file, f)
        return {"text_file": p}

    if text:
        uid = uuid.uuid4().hex
        p = f"uploads/{uid}.txt"
        open(p, "w", encoding="utf-8").write(text)
        return {"text_file": p}

    raise HTTPException(400, "Provide file or text")


@app.post("/youtube-subtitles", dependencies=[Depends(verify_key)])
async def youtube_ep(data: YouTubeURL):
    out = f"uploads/youtube_{uuid.uuid4().hex}.txt"
    extract_youtube(data.url, out)
    return {"text_file": out}


@app.post("/upload-video", dependencies=[Depends(verify_key)])
async def upload_video(file: UploadFile = File(...)):
    p = f"uploads/{file.filename}"
    with open(p, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"filename": p}


@app.post("/extract-audio", dependencies=[Depends(verify_key)])
async def extract_audio_ep(data: VideoFile):
    out = f"outputs/audio_{os.path.basename(data.video_file)}.mp3"
    extractAudio(data.video_file, out)
    return {"audio_file": out}


@app.post("/transcribe-native", dependencies=[Depends(verify_key)])
async def transcribe_native(data: AudioFile):
    out = f"outputs/native_{os.path.basename(data.audio_file)}.txt"
    t = call_whisper(data.audio_file)
    open(out, "w").write(t)
    return {"text_file": out, "transcription": t}


@app.post("/transcribe-english", dependencies=[Depends(verify_key)])
async def transcribe_english(data: AudioFile):
    out = f"outputs/en_{os.path.basename(data.audio_file)}.txt"
    t = call_whisper(data.audio_file, language="en")
    open(out, "w").write(t)
    return {"text_file": out, "transcription": t}


@app.post("/summarize-native", dependencies=[Depends(verify_key)])
async def summarize_native_ep(text_file: str = Form(...)):
    out = f"outputs/sum_native_{os.path.basename(text_file)}.txt"
    s = summarize_native(text_file, out)
    return {"summary_file": out, "summary": s}


@app.post("/summarize-english", dependencies=[Depends(verify_key)])
async def summarize_english_ep(text_file: str = Form(...)):
    out = f"outputs/sum_eng_{os.path.basename(text_file)}.txt"
    s = summarize_english(text_file, out)
    return {"summary_file": out, "summary": s}


@app.post("/tts-native", dependencies=[Depends(verify_key)])
async def tts_native_ep(data: SummaryFile):
    out = f"outputs/audio_native_{os.path.basename(data.summary_file)}.mp3"
    tts_native(data.summary_file, out)
    return {"audio_file": out}


@app.post("/tts-english", dependencies=[Depends(verify_key)])
async def tts_english_ep(data: SummaryFile):
    out = f"outputs/audio_english_{os.path.basename(data.summary_file)}.mp3"
    tts_english(data.summary_file, out)
    return {"audio_file": out}


@app.post("/fast-native", dependencies=[Depends(verify_key)])
async def fast_native_ep(data: AudioFile):
    out = f"outputs/fast_native_{os.path.basename(data.audio_file)}.mp3"
    fast_audio(data.audio_file, out)
    return {"fast_audio_file": out}


@app.post("/fast-english", dependencies=[Depends(verify_key)])
async def fast_english_ep(data: AudioFile):
    out = f"outputs/fast_english_{os.path.basename(data.audio_file)}.mp3"
    fast_audio(data.audio_file, out)
    return {"fast_audio_file": out}


@app.get("/files/{path:path}", dependencies=[Depends(verify_key)])
async def get_file(path):
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)


@app.get("/")
async def home():
    return {"status": "OK", "version": "v6", "secure": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
