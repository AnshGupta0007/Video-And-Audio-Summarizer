import React, { useState, useRef } from "react";
import './App.css'
const API_BASE = import.meta.env.VITE_API_BASE;
const HEADER_ICON = "/mnt/data/Screenshot 2025-11-25 at 2.57.40 PM.png";

// Remove invisible / zero-width characters
const cleanText = (txt = "") => (txt || "").replace(/[\u200B-\u200F\uFEFF]/g, "").trim();

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

  // ---------------- File Upload Helper ----------------
  const uploadFile = async (file, type) => {
    const fd = new FormData();
    fd.append("file", file);

    let endpoint = "";
    if (type === "video") endpoint = "/upload-video";
    if (type === "audio") endpoint = "/upload-audio";
    if (type === "text") endpoint = "/upload-text";

    const res = await fetch(${API_BASE}${endpoint}, {
      method: "POST",
      body: fd,
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(${endpoint} failed: ${res.status} ${txt});
    }

    return res.json();
  };

  const openServerFile = (filePath) => {
    if (filePath) {
      window.open(${API_BASE}/files/${encodeURIComponent(filePath)}, "_blank");
    }
  };

  const downloadText = (text, filename = "file.txt") => {
    const blob = new Blob([text || ""], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ------------------ VIDEO PIPELINE ------------------
  const handleVideoFile = async (file) => {
    setProgress([]);
    setProcessing(true);
    setResults(null);

    try {
      addProgress("Uploading video...");
      const up = await uploadFile(file, "video");

      addProgress("Extracting audio from video...");
      const extractRes = await fetch(${API_BASE}/extract-audio, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_file: up.filename }),
      });

      if (!extractRes.ok) throw new Error("Audio extraction failed");
      const extractData = await extractRes.json();
      await handleAudioPipeline(extractData.audio_file);
    } catch (e) {
      console.error(e);
      addProgress("Error: " + e.message);
      setProcessing(false);
    }
  };

  // ------------------ AUDIO PIPELINE ------------------
  const handleAudioFile = async (file) => {
    setProgress([]);
    setProcessing(true);
    setResults(null);

    try {
      addProgress("Uploading audio...");
      const up = await uploadFile(file, "audio");
      await handleAudioPipeline(up.filename);
    } catch (e) {
      console.error(e);
      addProgress("Error: " + e.message);
      setProcessing(false);
    }
  };

  const handleAudioPipeline = async (audioFilePath) => {
    try {
      addProgress("Transcribing (original)...");
      const t1 = await fetch(${API_BASE}/transcribe-native, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_file: audioFilePath }),
      });
      if (!t1.ok) throw new Error("Transcription failed (native)");
      const transNative = await t1.json();

      addProgress("Transcribing (English)...");
      const t2 = await fetch(${API_BASE}/transcribe-english, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_file: audioFilePath }),
      });
      if (!t2.ok) throw new Error("Transcription failed (English)");
      const transEnglish = await t2.json();

      await handleTextPipeline(transNative.text_file, transNative.transcription, transEnglish.transcription);
    } catch (e) {
      console.error(e);
      addProgress("Error: " + e.message);
      setProcessing(false);
    }
  };

  // ------------------ TEXT PIPELINE ------------------
  const handleTextPipeline = async (textFilePath, nativeTrans = "", englishTrans = "") => {
    try {
      const fd = new FormData();
      fd.append("text_file", textFilePath);

      // FAST MODE: quick summaries only
      if (mode === "fast") {
        addProgress("Creating quick summaries...");

        const s1 = await fetch(${API_BASE}/summarize-native, { method: "POST", body: fd });
        const sumNative = await s1.json();

        const s2 = await fetch(${API_BASE}/summarize-english, { method: "POST", body: fd });
        const sumEnglish = await s2.json();

        addProgress("Done!");

        setResults({
          transcriptionNative: nativeTrans,
          transcriptionEnglish: englishTrans,
          summaryNative: sumNative.summary,
          summaryEnglish: sumEnglish.summary,
          audioNative: "",
          audioEnglish: "",
          fastAudioNative: "",
          fastAudioEnglish: "",
        });

        setProcessing(false);
        return;
      }

      // FULL MODE
      addProgress("Summarizing (original language)...");
      const s1 = await fetch(${API_BASE}/summarize-native, { method: "POST", body: fd });
      const sumNative = await s1.json();

      addProgress("Summarizing (English)...");
      const s2 = await fetch(${API_BASE}/summarize-english, { method: "POST", body: fd });
      const sumEnglish = await s2.json();

      addProgress("Creating audio (original language)...");
      const a1 = await fetch(${API_BASE}/tts-native, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary_file: sumNative.summary_file }),
      });
      const audioNative = await a1.json();

      addProgress("Creating audio (English)...");
      const a2 = await fetch(${API_BASE}/tts-english, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary_file: sumEnglish.summary_file }),
      });
      const audioEnglish = await a2.json();

      addProgress("Speeding up audio...");
      const f1 = await fetch(${API_BASE}/fast-native, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_file: audioNative.audio_file }),
      });
      const fastNative = await f1.json();

      const f2 = await fetch(${API_BASE}/fast-english, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_file: audioEnglish.audio_file }),
      });
      const fastEnglish = await f2.json();

      addProgress("All done!");

      setResults({
        transcriptionNative: nativeTrans,
        transcriptionEnglish: englishTrans,
        summaryNative: sumNative.summary,
        summaryEnglish: sumEnglish.summary,
        audioNative: audioNative.audio_file,
        audioEnglish: audioEnglish.audio_file,
        fastAudioNative: fastNative.fast_audio_file,
        fastAudioEnglish: fastEnglish.fast_audio_file,
      });

      setProcessing(false);
    } catch (e) {
      console.error(e);
      addProgress("Error: " + e.message);
      setProcessing(false);
    }
  };

  // ---------------- Text Input Handler ----------------
  const handleTextSubmit = async (file) => {
    setProgress([]);
    setProcessing(true);
    setResults(null);

    try {
      let textFilePath;

      // File upload
      if (file) {
        addProgress("Uploading text file...");
        const up = await uploadFile(file, "text");
        textFilePath = up.text_file;
      } else {
        const cleaned = cleanText(textInput);
        if (!cleaned) {
          addProgress("Please enter some text first.");
          setProcessing(false);
          return;
        }

        addProgress("Sending text...");
        const fd = new FormData();
        fd.append("text", cleaned);

        const res = await fetch(${API_BASE}/upload-text, {
          method: "POST",
          body: fd,
        });

        const j = await res.json();
        textFilePath = j.text_file;
      }

      await handleTextPipeline(textFilePath, "", "");
    } catch (e) {
      console.error(e);
      addProgress("Error: " + e.message);
      setProcessing(false);
    }
  };

  // ---------------- YouTube Handler ----------------
  const handleYouTube = async () => {
    const url = youtubeUrl.trim();
    if (!url) {
      addProgress("Please enter a YouTube link.");
      return;
    }

    setProgress([]);
    setProcessing(true);
    setResults(null);

    try {
      addProgress("Fetching subtitles...");
      const res = await fetch(${API_BASE}/youtube-subtitles, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) throw new Error("Unable to fetch subtitles");
      const j = await res.json();

      addProgress("Processing subtitles...");
      await handleTextPipeline(j.text_file, "", "");
    } catch (e) {
      console.error(e);
      addProgress("YouTube Error: " + e.message);
      setProcessing(false);
    }
  };

  // ---------------- Drag & Drop ----------------
  const onDropFile = (e, type) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (type === "video") handleVideoFile(file);
    if (type === "audio") handleAudioFile(file);
    if (type === "text") handleTextSubmit(file);
  };

  const prevent = (e) => e.preventDefault();

  // ---------------- UI Helpers for Tailwind v4 safety ----------------
  const modeButtonBase = "flex-1 px-3 py-2 rounded-lg text-sm font-medium";
  const modeFullActive = "bg-indigo-600 text-white";
  const modeFullInactive = "bg-white border border-gray-200";
  const modeFastActive = "bg-green-600 text-white";
  const modeFastInactive = "bg-white border border-gray-200";

  // ---------------- UI ----------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-blue-50 to-white py-6">
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <img
              src={HEADER_ICON}
              alt="icon"
              className="w-10 h-10 rounded border"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />

            <div>
              <h1 className="text-2xl font-extrabold text-indigo-700">Video and Audio Summarizer</h1>
              <p className="text-xs text-gray-600">Upload media or paste text / YouTube link</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
          </div>
        </header>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg p-5">
          {/* Mode selector */}
          <div className="mb-4">
            <h2 className="text-md font-medium mb-2">Processing Mode</h2>

            <div className="flex gap-2">
              <button
                onClick={() => setMode("full")}
                className={${modeButtonBase} ${mode === "full" ? modeFullActive : modeFullInactive}}
              >
                Full Mode — 8 outputs
              </button>

              <button
                onClick={() => setMode("fast")}
                className={${modeButtonBase} ${mode === "fast" ? modeFastActive : modeFastInactive}}
              >
                Fast Mode — quick summary
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-2">
              {mode === "full" ? "Creates audio, fast audio, and summaries." : "Quick summaries only. No audio."}
            </p>
          </div>

          {/* Input type buttons */}
          <div className="mb-4">
            <h2 className="text-lg font-semibold mb-3">Choose input</h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <InputTile label="Video" emoji="🎥" active={inputType === "video"} onClick={() => setInputType("video")} sub="MP4" />
              <InputTile label="Audio" emoji="🎵" active={inputType === "audio"} onClick={() => setInputType("audio")} sub="MP3/WAV" />
              <InputTile label="Text" emoji="📝" active={inputType === "text"} onClick={() => setInputType("text")} sub="Paste or TXT" />
              <InputTile label="YouTube" emoji="▶️" active={inputType === "youtube"} onClick={() => setInputType("youtube")} sub="Captions" />
            </div>
          </div>

          {/* Input Panels */}
          <div className="space-y-4">
            {!inputType && <div className="text-center text-gray-500 p-6 border rounded">Choose a type to start</div>}

            {/* Video */}
            {inputType === "video" && (
              <div onDrop={(e) => onDropFile(e, "video")} onDragOver={prevent} className="border-2 border-dashed rounded-lg p-4">
                <label className="text-sm font-medium">Upload or drop a video</label>

                {/* CLEAR FILE INPUT */}
                <input
                  ref={videoRef}
                  type="file"
                  accept="video/mp4"
                  className="mt-3 block w-full border p-2 rounded cursor-pointer bg-gray-50 hover:bg-gray-100"
                  onChange={(e) => e.target.files?.[0] && handleVideoFile(e.target.files[0])}
                />

                <div className="text-xs text-gray-500 mt-2">Audio will be extracted automatically.</div>
              </div>
            )}

            {/* Audio */}
            {inputType === "audio" && (
              <div onDrop={(e) => onDropFile(e, "audio")} onDragOver={prevent} className="border-2 border-dashed rounded-lg p-4">
                <label className="text-sm font-medium">Upload or drop audio</label>

                <input
                  ref={audioRef}
                  type="file"
                  accept="audio/*"
                  className="mt-3 block w-full border p-2 rounded cursor-pointer bg-gray-50 hover:bg-gray-100"
                  onChange={(e) => e.target.files?.[0] && handleAudioFile(e.target.files[0])}
                />

                <div className="text-xs text-gray-500 mt-2">MP3 or WAV files work.</div>
              </div>
            )}

            {/* Text */}
            {inputType === "text" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 border rounded">
                  <label className="text-sm font-medium block mb-2">Paste text</label>

                  <textarea rows="6" value={textInput} onChange={(e) => setTextInput(e.target.value)} className="w-full p-3 border rounded text-sm" placeholder="Paste your text here..." />

                  <div className="flex gap-2 mt-3">
                    <button onClick={() => handleTextSubmit(null)} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded">
                      Process text
                    </button>

                    <button onClick={() => setTextInput("")} className="px-3 py-2 bg-gray-100 rounded">
                      Clear
                    </button>
                  </div>
                </div>

                <div onDrop={(e) => onDropFile(e, "text")} onDragOver={prevent} className="p-3 border rounded">
                  <label className="text-sm font-medium">Upload a text file</label>

                  <input
                    ref={textRef}
                    type="file"
                    accept=".txt"
                    className="mt-3 block w-full border p-2 rounded cursor-pointer bg-gray-50 hover:bg-gray-100"
                    onChange={(e) => e.target.files?.[0] && handleTextSubmit(e.target.files[0])}
                  />

                  <div className="text-xs text-gray-500 mt-2">Upload a .txt file to summarize it.</div>
                </div>
              </div>
            )}

            {/* YouTube */}
            {inputType === "youtube" && (
              <div className="p-3 border rounded">
                <label className="text-sm font-medium block mb-2">YouTube link</label>

                <input type="text" value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." className="w-full p-3 border rounded text-sm" />

                <div className="flex gap-2 mt-3">
                  <button onClick={handleYouTube} className="px-4 py-2 bg-indigo-600 text-white rounded">
                    Get subtitles & summarize
                  </button>

                  <button onClick={() => setYoutubeUrl("")} className="px-3 py-2 bg-gray-100 rounded">
                    Clear
                  </button>
                </div>

                <p className="text-xs text-gray-500 mt-2">Works with normal, short, and youtu.be links.</p>
              </div>
            )}
          </div>
        </div>

        {/* Progress Log */}
        {processing && (
          <div className="bg-white mt-4 rounded-xl shadow p-3">
            <h3 className="font-semibold text-sm mb-2">Processing...</h3>
            <div className="max-h-36 overflow-auto text-sm space-y-1">
              {progress.map((p, i) => (
                <div key={i}>
                  • {p.msg} <span className="ml-2 text-gray-400 text-xs">{p.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="bg-white mt-4 rounded-xl shadow p-4 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">{mode === "full" ? "Results (8 outputs)" : "Results (Fast Summary)"}</h2>
              <button
                onClick={() => {
                  setResults(null);
                  setProgress([]);
                  setInputType(null);
                }}
                className="px-3 py-2 bg-gray-100 rounded text-sm"
              >
                New job
              </button>
            </div>

            {/* Transcriptions */}
            <SectionToggle
              title="Transcriptions"
              collapsed={collapsed.transcriptions}
              onClick={() => setCollapsed({ ...collapsed, transcriptions: !collapsed.transcriptions })}
            >
              <TwoCol>
                <TranscriptionBlock title="Original" data={results.transcriptionNative} filename="transcription_native.txt" downloadText={downloadText} />
                <TranscriptionBlock title="English" data={results.transcriptionEnglish} filename="transcription_english.txt" downloadText={downloadText} />
              </TwoCol>
            </SectionToggle>

            {/* Summaries */}
            <SectionToggle title="Summaries" collapsed={collapsed.summaries} onClick={() => setCollapsed({ ...collapsed, summaries: !collapsed.summaries })}>
              <TwoCol>
                <TranscriptionBlock title="Original" data={results.summaryNative} filename="summary_native.txt" downloadText={downloadText} />
                <TranscriptionBlock title="English" data={results.summaryEnglish} filename="summary_english.txt" downloadText={downloadText} />
              </TwoCol>
            </SectionToggle>

            {/* Audio */}
            {mode === "full" && (
              <SectionToggle title="Audio Files" collapsed={collapsed.audio} onClick={() => setCollapsed({ ...collapsed, audio: !collapsed.audio })}>
                <TwoCol>
                  <AudioBlock title="Original Summary" file={results.audioNative} openServerFile={openServerFile} />
                  <AudioBlock title="English Summary" file={results.audioEnglish} openServerFile={openServerFile} />
                  <AudioBlock title="Fast Original (1.5x)" file={results.fastAudioNative} openServerFile={openServerFile} />
                  <AudioBlock title="Fast English (1.5x)" file={results.fastAudioEnglish} openServerFile={openServerFile} />
                </TwoCol>
              </SectionToggle>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Small UI Components ---------------- */

function InputTile({ label, emoji, active, onClick, sub }) {
  // Build className with static pieces so Tailwind v4 extracts all utilities
  const base = "flex flex-col items-center gap-1 p-3 rounded-lg text-sm border";
  const activeClasses = "bg-indigo-50 border-indigo-300";
  const inactiveClasses = "bg-white border-gray-200";
  const cls = active ? ${base} ${activeClasses} : ${base} ${inactiveClasses};

  return (
    <button onClick={onClick} className={cls}>
      <div className="text-2xl">{emoji}</div>
      <div className="font-medium">{label}</div>
      <div className="text-xs text-gray-500">{sub}</div>
    </button>
  );
}

function SectionToggle({ title, collapsed, onClick, children }) {
  return (
    <div className="border rounded">
      <div className="flex justify-between items-center p-3 cursor-pointer" onClick={onClick}>
        <strong>{title}</strong>
        <span className="text-xs text-gray-500">{collapsed ? "Expand" : "Collapse"}</span>
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
        <button onClick={() => downloadText(data, filename)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">
          Download
        </button>
      </div>

      <pre className="text-sm text-gray-800 whitespace-pre-wrap break-words">{data || "(none)"}</pre>
    </div>
  );
}

function AudioBlock({ title, file, openServerFile }) {
  // Build source url statically so extractor sees classes/strings clearly
  const src = file ? ${API_BASE}/files/${encodeURIComponent(file)} : "";

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <small className="font-medium">{title}</small>
        <button onClick={() => openServerFile(file)} className="px-2 py-1 bg-indigo-600 text-white rounded text-xs">
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
