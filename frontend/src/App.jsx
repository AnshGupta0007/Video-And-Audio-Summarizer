import React, { useState, useRef } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE;
const API_KEY = import.meta.env.VITE_BACKEND_SECRET;

const HEADER_ICON = "/mnt/data/Screenshot 2025-11-25 at 2.57.40 PM.png";

const cleanText = (t = "") => (t || "").replace(/[\u200B-\u200F\uFEFF]/g, "").trim();

/* -------------------------------------------------------
   UNIVERSAL SECURE FETCH (Auto-adds API Key)
------------------------------------------------------- */
async function secureFetch(url, options = {}) {
  const final = {
    ...options,
    headers: {
      ...(options.headers || {}),
      "x-api-key": API_KEY,
    },
  };

  const res = await fetch(url, final);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed ${res.status}: ${text}`);
  }

  return res;
}

export default function App() {
  const [mode, setMode] = useState("full");
  const [inputType, setInputType] = useState(null);
  const [textInput, setTextInput] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState([]);
  const [results, setResults] = useState(null);

  const [collapsed, setCollapsed] = useState({
    transcriptions: false,
    summaries: false,
    audio: false,
  });

  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const textRef = useRef(null);

  const addProgress = (msg) =>
    setProgress((p) => [...p, { msg, time: new Date().toLocaleTimeString() }]);

  /* -------------------------------------------------------
     Upload File (patched)
  ------------------------------------------------------- */
  const uploadFile = async (file, type) => {
    const fd = new FormData();
    fd.append("file", file);

    let endpoint = "";
    if (type === "video") endpoint = "/upload-video";
    if (type === "audio") endpoint = "/upload-audio";
    if (type === "text") endpoint = "/upload-text";

    const res = await secureFetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      body: fd,
    });

    return res.json();
  };

  const openServerFile = (filePath) => {
    if (filePath) {
      window.open(
        `${API_BASE}/files/${encodeURIComponent(filePath)}?x-api-key=${API_KEY}`,
        "_blank"
      );
    }
  };

  const downloadText = (text, filename = "file.txt") => {
    const blob = new Blob([text || ""], { type: "text/plain;charset=utf-8" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(u);
  };

  /* -------------------------------------------------------
     VIDEO PIPELINE
  ------------------------------------------------------- */
  const handleVideoFile = async (file) => {
    setProgress([]);
    setProcessing(true);
    setResults(null);

    try {
      addProgress("Uploading video...");
      const up = await uploadFile(file, "video");

      addProgress("Extracting audio...");
      const r = await secureFetch(`${API_BASE}/extract-audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_file: up.filename }),
      });

      const j = await r.json();
      await handleAudioPipeline(j.audio_file);
    } catch (e) {
      addProgress("Error: " + e.message);
      setProcessing(false);
    }
  };

  /* -------------------------------------------------------
     AUDIO PIPELINE
  ------------------------------------------------------- */
  const handleAudioFile = async (file) => {
    setProgress([]);
    setProcessing(true);
    setResults(null);

    try {
      addProgress("Uploading audio...");
      const up = await uploadFile(file, "audio");
      await handleAudioPipeline(up.filename);
    } catch (e) {
      addProgress("Error: " + e.message);
      setProcessing(false);
    }
  };

  const handleAudioPipeline = async (audioFilePath) => {
    try {
      addProgress("Transcribing original...");
      const t1 = await secureFetch(`${API_BASE}/transcribe-native`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_file: audioFilePath }),
      });

      const j1 = await t1.json();

      addProgress("Transcribing English...");
      const t2 = await secureFetch(`${API_BASE}/transcribe-english`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_file: audioFilePath }),
      });

      const j2 = await t2.json();

      await handleTextPipeline(j1.text_file, j1.transcription, j2.transcription);
    } catch (e) {
      addProgress("Error: " + e.message);
      setProcessing(false);
    }
  };

  /* -------------------------------------------------------
     TEXT PIPELINE
  ------------------------------------------------------- */
  const handleTextPipeline = async (
    textFilePath,
    nativeTrans = "",
    englishTrans = ""
  ) => {
    try {
      const fd = new FormData();
      fd.append("text_file", textFilePath);

      if (mode === "fast") {
        addProgress("Summarizing (native)...");
        const s1 = await secureFetch(`${API_BASE}/summarize-native`, {
          method: "POST",
          body: fd,
        });
        const n = await s1.json();

        addProgress("Summarizing (English)...");
        const s2 = await secureFetch(`${API_BASE}/summarize-english`, {
          method: "POST",
          body: fd,
        });
        const e = await s2.json();

        setResults({
          transcriptionNative: nativeTrans,
          transcriptionEnglish: englishTrans,
          summaryNative: n.summary,
          summaryEnglish: e.summary,
        });

        setProcessing(false);
        return;
      }

      /* -------- FULL MODE -------- */
      addProgress("Summarizing (native)...");
      const s1 = await secureFetch(`${API_BASE}/summarize-native`, {
        method: "POST",
        body: fd,
      });
      const sn = await s1.json();

      addProgress("Summarizing (English)...");
      const s2 = await secureFetch(`${API_BASE}/summarize-english`, {
        method: "POST",
        body: fd,
      });
      const se = await s2.json();

      addProgress("Generating audio...");
      const a1 = await secureFetch(`${API_BASE}/tts-native`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary_file: sn.summary_file }),
      });
      const an = await a1.json();

      const a2 = await secureFetch(`${API_BASE}/tts-english`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary_file: se.summary_file }),
      });
      const ae = await a2.json();

      addProgress("Creating fast audio...");
      const f1 = await secureFetch(`${API_BASE}/fast-native`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_file: an.audio_file }),
      });
      const fn = await f1.json();

      const f2 = await secureFetch(`${API_BASE}/fast-english`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_file: ae.audio_file }),
      });
      const fe = await f2.json();

      setResults({
        transcriptionNative: nativeTrans,
        transcriptionEnglish: englishTrans,
        summaryNative: sn.summary,
        summaryEnglish: se.summary,
        audioNative: an.audio_file,
        audioEnglish: ae.audio_file,
        fastAudioNative: fn.fast_audio_file,
        fastAudioEnglish: fe.fast_audio_file,
      });

      setProcessing(false);
    } catch (e) {
      addProgress("Error: " + e.message);
      setProcessing(false);
    }
  };

  /* -------------------------------------------------------
     TEXT INPUT
  ------------------------------------------------------- */
  const handleTextSubmit = async (file) => {
    setProgress([]);
    setProcessing(true);
    setResults(null);

    try {
      let textFilePath;

      if (file) {
        addProgress("Uploading text file...");
        const up = await uploadFile(file, "text");
        textFilePath = up.text_file;
      } else {
        const cleaned = cleanText(textInput);
        if (!cleaned) {
          addProgress("Enter some text first.");
          setProcessing(false);
          return;
        }

        addProgress("Sending text...");
        const fd = new FormData();
        fd.append("text", cleaned);

        const r = await secureFetch(`${API_BASE}/upload-text`, {
          method: "POST",
          body: fd,
        });

        const j = await r.json();
        textFilePath = j.text_file;
      }

      await handleTextPipeline(textFilePath);
    } catch (e) {
      addProgress("Error: " + e.message);
      setProcessing(false);
    }
  };

  /* -------------------------------------------------------
     YOUTUBE
  ------------------------------------------------------- */
  const handleYouTube = async () => {
    if (!youtubeUrl.trim()) {
      addProgress("Enter a YouTube URL.");
      return;
    }

    setProgress([]);
    setProcessing(true);
    setResults(null);

    try {
      addProgress("Fetching subtitles...");
      const r = await secureFetch(`${API_BASE}/youtube-subtitles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl }),
      });

      const j = await r.json();
      await handleTextPipeline(j.text_file);
    } catch (e) {
      addProgress("YouTube Error: " + e.message);
      setProcessing(false);
    }
  };

  /* -------------------------------------------------------
     DRAG & DROP
  ------------------------------------------------------- */
  const onDropFile = (e, type) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (!f) return;

    if (type === "video") handleVideoFile(f);
    if (type === "audio") handleAudioFile(f);
    if (type === "text") handleTextSubmit(f);
  };

  const prevent = (e) => e.preventDefault();

  /* -------------------------------------------------------
     UI RENDER
  ------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-blue-50 to-white py-6">
      <div className="max-w-2xl mx-auto px-4">

        {/* HEADER */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <img
              src={HEADER_ICON}
              className="w-10 h-10 rounded border"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />

            <div>
              <h1 className="text-2xl font-bold text-indigo-700">
                Video & Audio Summarizer
              </h1>
              <p className="text-xs text-gray-600">
                Upload media, paste text, or enter YouTube URL
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              setInputType(null);
              setTextInput("");
              setYoutubeUrl("");
              setResults(null);
              setProgress([]);
              setProcessing(false);
            }}
            className="px-3 py-2 bg-white border rounded shadow-sm text-sm"
          >
            Reset
          </button>
        </header>

        {/* MAIN CARD */}
        <div className="bg-white rounded-xl shadow p-5">
          <h2 className="text-md font-medium mb-2">Processing Mode</h2>

          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setMode("full")}
              className={`flex-1 px-3 py-2 rounded text-sm font-medium ${
                mode === "full"
                  ? "bg-indigo-600 text-white"
                  : "bg-white border border-gray-300"
              }`}
            >
              Full (8 outputs)
            </button>

            <button
              onClick={() => setMode("fast")}
              className={`flex-1 px-3 py-2 rounded text-sm font-medium ${
                mode === "fast"
                  ? "bg-green-600 text-white"
                  : "bg-white border border-gray-300"
              }`}
            >
              Fast (summary only)
            </button>
          </div>

          {/* INPUT TYPE */}
          <h2 className="text-lg font-semibold mb-3">Choose Input</h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <Tile label="Video" emoji="🎥" active={inputType === "video"} onClick={() => setInputType("video")} sub="MP4" />
            <Tile label="Audio" emoji="🎵" active={inputType === "audio"} onClick={() => setInputType("audio")} sub="MP3/WAV" />
            <Tile label="Text" emoji="📝" active={inputType === "text"} onClick={() => setInputType("text")} sub="Paste/TXT" />
            <Tile label="YouTube" emoji="▶️" active={inputType === "youtube"} onClick={() => setInputType("youtube")} sub="Captions" />
          </div>

          {/* PANELS */}

          {!inputType && (
            <div className="p-6 border rounded text-center text-gray-500">
              Choose an input type to begin.
            </div>
          )}

          {inputType === "video" && (
            <DropPanel
              label="Upload or drop a video"
              accept="video/mp4"
              onChange={(e) => e.target.files?.[0] && handleVideoFile(e.target.files[0])}
              onDrop={(e) => onDropFile(e, "video")}
              refObj={videoRef}
              note="Audio will be extracted automatically."
            />
          )}

          {inputType === "audio" && (
            <DropPanel
              label="Upload or drop audio"
              accept="audio/*"
              onChange={(e) => e.target.files?.[0] && handleAudioFile(e.target.files[0])}
              onDrop={(e) => onDropFile(e, "audio")}
              refObj={audioRef}
              note="MP3/WAV supported."
            />
          )}

          {inputType === "text" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 border rounded">
                <label className="text-sm font-medium block mb-2">Paste text</label>
                <textarea
                  rows="6"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  className="w-full p-3 border rounded text-sm"
                />

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleTextSubmit(null)}
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded"
                  >
                    Process
                  </button>

                  <button
                    onClick={() => setTextInput("")}
                    className="px-3 py-2 bg-gray-100 rounded"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <DropPanel
                label="Upload a text file"
                accept=".txt"
                onChange={(e) =>
                  e.target.files?.[0] && handleTextSubmit(e.target.files[0])
                }
                onDrop={(e) => onDropFile(e, "text")}
                refObj={textRef}
                note=".txt files only."
              />
            </div>
          )}

          {inputType === "youtube" && (
            <YouTubePanel
              url={youtubeUrl}
              setUrl={setYoutubeUrl}
              handleYouTube={handleYouTube}
            />
          )}
        </div>

        {/* PROCESSING LOG */}
        {processing && (
          <div className="bg-white mt-4 rounded-xl shadow p-3">
            <h3 className="font-semibold text-sm mb-2">Processing…</h3>
            <div className="max-h-36 overflow-auto text-sm space-y-1">
              {progress.map((p, i) => (
                <div key={i}>
                  • {p.msg}{" "}
                  <span className="text-xs text-gray-400 ml-2">{p.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RESULTS */}
        {results && (
          <ResultsSection
            mode={mode}
            results={results}
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            downloadText={downloadText}
            openServerFile={openServerFile}
            setResults={setResults}
            setInputType={setInputType}
            setProgress={setProgress}
          />
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------
   SMALL COMPONENTS
-------------------------------------------------------------- */

function Tile({ label, emoji, active, onClick, sub }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center p-3 border rounded-lg ${
        active ? "bg-indigo-50 border-indigo-300" : "bg-white border-gray-200"
      }`}
    >
      <div className="text-2xl">{emoji}</div>
      <div className="font-medium">{label}</div>
      <div className="text-xs text-gray-500">{sub}</div>
    </button>
  );
}

const DropPanel = React.forwardRef(({ label, accept, onChange, onDrop, note }, ref) => (
  <div
    onDrop={onDrop}
    onDragOver={(e) => e.preventDefault()}
    className="border-2 border-dashed rounded-lg p-4"
  >
    <label className="text-sm font-medium">{label}</label>
    <input
      ref={ref}
      type="file"
      accept={accept}
      className="mt-3 block w-full border p-2 rounded bg-gray-50 cursor-pointer"
      onChange={onChange}
    />
    <div className="text-xs text-gray-500 mt-2">{note}</div>
  </div>
));

function YouTubePanel({ url, setUrl, handleYouTube }) {
  return (
    <div className="p-3 border rounded">
      <label className="text-sm font-medium block mb-2">YouTube link</label>

      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://youtube.com/watch?v=..."
        className="w-full p-3 border rounded text-sm"
      />

      <div className="flex gap-2 mt-3">
        <button
          onClick={handleYouTube}
          className="px-4 py-2 bg-indigo-600 text-white rounded"
        >
          Process
        </button>
        <button
          onClick={() => setUrl("")}
          className="px-3 py-2 bg-gray-100 rounded"
        >
          Clear
        </button>
      </div>

      <p className="text-xs text-gray-500 mt-2">
        Works with watch?v=, shorts, and youtu.be links.
      </p>
    </div>
  );
}

function SectionToggle({ title, collapsed, onClick, children }) {
  return (
    <div className="border rounded">
      <div
        className="flex justify-between items-center p-3 cursor-pointer"
        onClick={onClick}
      >
        <strong>{title}</strong>
        <span className="text-xs text-gray-500">
          {collapsed ? "Expand" : "Collapse"}
        </span>
      </div>

      {!collapsed && <div className="p-3">{children}</div>}
    </div>
  );
}

function TwoCol({ children }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>;
}

function TranscriptionBlock({ title, data, filename, downloadText }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <small className="font-medium">{title}</small>
        <button
          onClick={() => downloadText(data, filename)}
          className="px-2 py-1 bg-blue-600 text-white rounded text-xs"
        >
          Download
        </button>
      </div>

      <pre className="text-sm text-gray-800 whitespace-pre-wrap break-words">
        {data || "(none)"}
      </pre>
    </div>
  );
}

function AudioBlock({ title, file, openServerFile }) {
  const src = file
    ? `${API_BASE}/files/${encodeURIComponent(file)}?x-api-key=${API_KEY}`
    : "";

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <small className="font-medium">{title}</small>
        <button
          onClick={() => openServerFile(file)}
          className="px-2 py-1 bg-indigo-600 text-white rounded text-xs"
        >
          Download
        </button>
      </div>

      {file ? (
        <audio controls className="w-full">
          <source src={src} type="audio/mpeg" />
        </audio>
      ) : (
        <div className="text-sm text-gray-500">No file</div>
      )}
    </div>
  );
}

function ResultsSection({
  mode,
  results,
  collapsed,
  setCollapsed,
  downloadText,
  openServerFile,
  setResults,
  setInputType,
  setProgress,
}) {
  return (
    <div className="bg-white mt-4 rounded-xl shadow p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">
          {mode === "full" ? "Results (8 outputs)" : "Results (Fast Summaries)"}
        </h2>

        <button
          onClick={() => {
            setResults(null);
            setProgress([]);
            setInputType(null);
          }}
          className="px-3 py-2 bg-gray-100 rounded text-sm"
        >
          New Job
        </button>
      </div>

      {/* Transcriptions */}
      <SectionToggle
        title="Transcriptions"
        collapsed={collapsed.transcriptions}
        onClick={() =>
          setCollapsed({
            ...collapsed,
            transcriptions: !collapsed.transcriptions,
          })
        }
      >
        <TwoCol>
          <TranscriptionBlock
            title="Original"
            data={results.transcriptionNative}
            filename="transcription_native.txt"
            downloadText={downloadText}
          />

          <TranscriptionBlock
            title="English"
            data={results.transcriptionEnglish}
            filename="transcription_english.txt"
            downloadText={downloadText}
          />
        </TwoCol>
      </SectionToggle>

      {/* Summaries */}
      <SectionToggle
        title="Summaries"
        collapsed={collapsed.summaries}
        onClick={() =>
          setCollapsed({
            ...collapsed,
            summaries: !collapsed.summaries,
          })
        }
      >
        <TwoCol>
          <TranscriptionBlock
            title="Original"
            data={results.summaryNative}
            filename="summary_native.txt"
            downloadText={downloadText}
          />

          <TranscriptionBlock
            title="English"
            data={results.summaryEnglish}
            filename="summary_english.txt"
            downloadText={downloadText}
          />
        </TwoCol>
      </SectionToggle>

      {/* Audio (full mode only) */}
      {mode === "full" && (
        <SectionToggle
          title="Audio Outputs"
          collapsed={collapsed.audio}
          onClick={() =>
            setCollapsed({ ...collapsed, audio: !collapsed.audio })
          }
        >
          <TwoCol>
            <AudioBlock
              title="Original Summary"
              file={results.audioNative}
              openServerFile={openServerFile}
            />
            <AudioBlock
              title="English Summary"
              file={results.audioEnglish}
              openServerFile={openServerFile}
            />
            <AudioBlock
              title="Fast Original (1.5x)"
              file={results.fastAudioNative}
              openServerFile={openServerFile}
            />
            <AudioBlock
              title="Fast English (1.5x)"
              file={results.fastAudioEnglish}
              openServerFile={openServerFile}
            />
          </TwoCol>
        </SectionToggle>
      )}
    </div>
  );
}
