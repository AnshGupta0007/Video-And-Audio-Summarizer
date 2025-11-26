

import os
import re
import shutil
import subprocess
import logging
from typing import Optional
import uuid

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from openai import OpenAI
from langdetect import detect
from gtts import gTTS
import yt_dlp

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("media-processor")

app = FastAPI(title="Media Processor API (Fixed Edition)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENAI_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_KEY) if OPENAI_KEY else None

os.makedirs("uploads", exist_ok=True)
os.makedirs("outputs", exist_ok=True)

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

    uid = str(uuid.uuid4())
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

    if not os.path.exists(expected):
        if os.path.exists(expected + ".mp3"):
            expected = expected + ".mp3"
        else:
            raise HTTPException(500, "Audio file missing")

    transcript = call_whisper(expected)

    with open(textFile, "w") as f:
        f.write(transcript)

    os.remove(expected)
    return textFile

def summarize_native(path, out):
    text = open(path).read()
    r = client.chat.completions.create(
        model="gpt-4o-mini",
        messages = [
    {"role": "system", "content": "Summarize the user's text in the same language. Keep it extremely concise while preserving the full context and meaning. Use the minimal number of words needed."},
    {"role": "user", "content": text},
]
,
    )
    s = r.choices[0].message.content
    open(out, "w").write(s)
    return s

def summarize_english(path, out):
    text = open(path).read()
    r = client.chat.completions.create(
        model="gpt-4o-mini",
        messages = [
    {
        "role": "system",
        "content": "Summarize the user's text in English. Keep it extremely concise while preserving the full meaning and context. Use the fewest words possible."
    },
    {
        "role": "user",
        "content": text
    }
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


@app.post("/upload-audio")
async def upload_audio(file: UploadFile = File(...)):
    """Upload audio file endpoint"""
    p = f"uploads/{file.filename}"
    with open(p, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"filename": p}

@app.post("/upload-text")
async def upload_text(file: UploadFile = File(None), text: str = Form(None)):
    """Upload text file or receive pasted text"""
    if file:
        p = f"uploads/{file.filename}"
        with open(p, "wb") as f:
            shutil.copyfileobj(file.file, f)
        return {"text_file": p}
    elif text:
        uid = str(uuid.uuid4())
        p = f"uploads/pasted_{uid}.txt"
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        return {"text_file": p}
    else:
        raise HTTPException(400, "Either file or text must be provided")


@app.post("/youtube-subtitles")
async def youtube_ep(data: YouTubeURL):
    out = "uploads/youtube.txt"
    extract_youtube(data.url, out)
    return {"text_file": out}

@app.post("/upload-video")
async def upload_video(file: UploadFile = File(...)):
    p = f"uploads/{file.filename}"
    with open(p, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"filename": p}

@app.post("/extract-audio")
async def extract_audio_ep(data: VideoFile):
    out = f"outputs/audio_{os.path.basename(data.video_file)}.mp3"
    extractAudio(data.video_file, out)
    return {"audio_file": out}

@app.post("/transcribe-native")
async def tn(data: AudioFile):
    out = f"outputs/native_{os.path.basename(data.audio_file)}.txt"
    t = call_whisper(data.audio_file)
    open(out, "w").write(t)
    return {"text_file": out, "transcription": t}

@app.post("/transcribe-english")
async def te(data: AudioFile):
    out = f"outputs/en_{os.path.basename(data.audio_file)}.txt"
    t = call_whisper(data.audio_file, language="en")
    open(out, "w").write(t)
    return {"text_file": out, "transcription": t}

@app.post("/summarize-native")
async def sn(text_file: str = Form(...)):
    out = f"outputs/sum_native_{os.path.basename(text_file)}.txt"
    s = summarize_native(text_file, out)
    return {"summary_file": out, "summary": s}

@app.post("/summarize-english")
async def se(text_file: str = Form(...)):
    out = f"outputs/sum_eng_{os.path.basename(text_file)}.txt"
    s = summarize_english(text_file, out)
    return {"summary_file": out, "summary": s}

@app.post("/tts-native")
async def tn2(data: SummaryFile):
    out = f"outputs/audio_native_{os.path.basename(data.summary_file)}.mp3"
    tts_native(data.summary_file, out)
    return {"audio_file": out}

@app.post("/tts-english")
async def te2(data: SummaryFile):
    out = f"outputs/audio_english_{os.path.basename(data.summary_file)}.mp3"
    tts_english(data.summary_file, out)
    return {"audio_file": out}

@app.post("/fast-native")
async def fn(data: AudioFile):
    out = f"outputs/fast_native_{os.path.basename(data.audio_file)}.mp3"
    fast_audio(data.audio_file, out)
    return {"fast_audio_file": out}

@app.post("/fast-english")
async def fe(data: AudioFile):
    out = f"outputs/fast_english_{os.path.basename(data.audio_file)}.mp3"
    fast_audio(data.audio_file, out)
    return {"fast_audio_file": out}

@app.get("/files/{path:path}")
async def get_file(path):
    if not os.path.exists(path):
        raise HTTPException(404)
    return FileResponse(path)

@app.get("/")
async def root():
    return {"status": "OK — Fixed version with all endpoints"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)