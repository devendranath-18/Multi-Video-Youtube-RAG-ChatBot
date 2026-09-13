"use client";

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API_BASE = "http://127.0.0.1:8000";

type Video = {
  video_id: string;
  title: string;
};

type Source = {
  title: string;
  timestamp: string;
  url: string;
};

type ChatEntry = {
  question: string;
  answer: string;
  sources: Source[];
};

function SourceList({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-4 pt-4 border-t border-[#E3DDCE]">
      <p className="text-[13px] text-[#8A8272] mb-2">Referenced in these clips</p>
      <div className="flex flex-wrap gap-2">
        {sources.map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] px-2.5 py-1 rounded-full border border-[#E3DDCE] bg-[#FBF9F4] text-[#1F6F6F] hover:border-[#1F6F6F] transition-colors"
          >
            <span className="font-mono text-[11px] text-[#8A8272]">{s.timestamp}</span>
            <span className="truncate max-w-[180px]">{s.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function Answer({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none font-sans prose-headings:font-semibold prose-headings:text-[#1C1B19] prose-p:text-[#2A2823] prose-p:leading-relaxed prose-li:text-[#2A2823] prose-strong:text-[#1C1B19] prose-a:text-[#1F6F6F]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [videoInput, setVideoInput] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const fetchVideos = async () => {
    try {
      const res = await fetch(`${API_BASE}/videos`);
      const data = await res.json();
      setVideos(data.videos || []);
    } catch (e) {
      console.error("Failed to fetch videos", e);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const handleIngest = async () => {
    if (!videoInput.trim()) return;
    setIngesting(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url_or_id: videoInput.trim() }),
      });
      const data = await res.json();
      if (data.status === "error") {
        setError(data.message);
      } else {
        setVideoInput("");
        await fetchVideos();
      }
    } catch (e) {
      setError("Couldn't reach the backend. Is the server running?");
    } finally {
      setIngesting(false);
    }
  };

  const handleDeleteVideo = async (videoId: string) => {
    try {
      await fetch(`${API_BASE}/videos/${videoId}`, { method: "DELETE" });
      await fetchVideos();
    } catch (e) {
      setError("Couldn't remove that video.");
    }
  };

  const handleClearAll = async () => {
    if (!confirm("Delete all videos? This can't be undone.")) return;
    try {
      await fetch(`${API_BASE}/videos`, { method: "DELETE" });
      await fetchVideos();
    } catch (e) {
      setError("Couldn't clear videos.");
    }
  };

  const handleAsk = async () => {
    if (!question.trim() || asking) return;
    const currentQuestion = question.trim();
    setAsking(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: currentQuestion }),
      });
      const data = await res.json();
      if (data.status === "error") {
        setError(data.message);
      } else {
        setHistory((prev) => [
  ...prev,
  {
    question: currentQuestion,
    answer: data.answer,
    sources: data.sources || [],
  },
]);
setQuestion("");
setSelectedIndex(null);
      }
    } catch (e) {
      setError("Couldn't reach the backend. Is the server running?");
    } finally {
      setAsking(false);
    }
  };

 const latest = history.length > 0 ? history[history.length - 1] : null;
const older = history.length > 1 ? history.slice(0, -1) : [];
const displayed = selectedIndex !== null ? older[selectedIndex] : latest;

  return (
    <main className="min-h-screen bg-[#F6F3EC] text-[#1C1B19]">
      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-[30px] leading-none font-semibold tracking-tight">
            Multi Video youtube RAG Chatbot.
          </h1>
          <p className="text-[15px] text-[#8A8272] mt-1">
            Drop in a few YouTube videos, then ask questions across all of them at once.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">
          {/* LEFT: Sources + History panel */}
          <aside className="flex flex-col gap-6 lg:sticky lg:top-10">
            <div className="bg-white border border-[#E3DDCE] rounded-md p-5">
              <h2 className="text-[15px] font-semibold mb-3">Sources</h2>

              <div className="flex flex-col gap-2 mb-4">
                <input
                  type="text"
                  value={videoInput}
                  onChange={(e) => setVideoInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleIngest()}
                  placeholder="YouTube URL or video ID"
                  className="w-full text-[14px] border border-[#DDD6C4] rounded px-3 py-2 bg-[#FBF9F4] placeholder:text-[#A8A192] focus:outline-none focus:border-[#C97A2B] focus:ring-1 focus:ring-[#C97A2B]"
                />
                <button
                  onClick={handleIngest}
                  disabled={ingesting || !videoInput.trim()}
                  className="w-full text-[14px] font-medium bg-[#C97A2B] text-white rounded px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#B56A22] transition-colors"
                >
                  {ingesting ? "Adding video…" : "Add video"}
                </button>
              </div>

              {videos.length === 0 ? (
                <p className="text-[13px] text-[#A8A192] leading-relaxed">
                  No videos yet. Add one above to start comparing.
                </p>
              ) : (
                <>
                  <ul className="flex flex-col gap-1.5">
                    {videos.map((v) => (
                      <li
                        key={v.video_id}
                        className="group flex items-start justify-between gap-2 text-[13px] text-[#2A2823] border-l-2 border-[#C97A2B]/40 pl-2.5 py-0.5 leading-snug"
                      >
                        <span className="flex-1">{v.title}</span>
                        <button
                          onClick={() => handleDeleteVideo(v.video_id)}
                          title="Remove this video"
                          className="text-[#A8A192] hover:text-[#B3452C] opacity-0 group-hover:opacity-100 transition-opacity text-[13px] leading-snug"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={handleClearAll}
                    className="mt-3 text-[12px] text-[#B3452C] hover:underline"
                  >
                    Clear all videos
                  </button>
                </>
              )}
            </div>

            {/* History — now stacked under Sources */}
            {older.length > 0 && (
  <div className="bg-white border border-[#E3DDCE] rounded-md p-5">
    <h2 className="text-[15px] font-semibold mb-3">History</h2>
    <div className="flex flex-col gap-1.5">
      {older
        .slice()
        .reverse()
        .map((entry, reverseIdx) => {
          const actualIndex = older.length - 1 - reverseIdx;
          return (
            <button
              key={actualIndex}
              onClick={() => setSelectedIndex(actualIndex)}
              className={`text-left text-[13px] leading-snug border-l-2 pl-2.5 py-0.5 truncate transition-colors ${
                selectedIndex === actualIndex
                  ? "border-[#1F6F6F] text-[#1F6F6F] font-medium"
                  : "border-[#C97A2B]/40 text-[#2A2823] hover:border-[#C97A2B]"
              }`}
            >
              {entry.question}
            </button>
          );
        })}
    </div>
  </div>
)}
          </aside>

          {/* RIGHT: Conversation panel */}
          <section className="flex flex-col gap-4">
            {/* Ask box */}
            <div className="bg-white border border-[#E3DDCE] rounded-md p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                  placeholder={
                    videos.length === 0
                      ? "Add a video first to start asking questions"
                      : "e.g. How does backpropagation work?"
                  }
                  disabled={videos.length === 0}
                  className="flex-1 text-[14px] border border-[#DDD6C4] rounded px-3 py-2 bg-[#FBF9F4] placeholder:text-[#A8A192] focus:outline-none focus:border-[#1F6F6F] focus:ring-1 focus:ring-[#1F6F6F] disabled:opacity-50"
                />
                <button
                  onClick={handleAsk}
                  disabled={asking || videos.length === 0 || !question.trim()}
                  className="text-[14px] font-medium bg-[#1F6F6F] text-white rounded px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#195A5A] transition-colors flex items-center gap-2"
                >
                  {asking && (
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {asking ? "Thinking…" : "Ask"}
                </button>
              </div>

              {error && (
                <p className="text-[13px] text-[#B3452C] bg-[#FBEDE7] px-3 py-2 rounded mt-3">
                  {error}
                </p>
              )}
            </div>

            {/* Empty state */}
            {!latest && !error && (
              <div className="text-center py-16 text-[#A8A192]">
                <p className="text-[15px]">Your answers will show up here.</p>
              </div>
            )}

            {/* Latest answer */}
            {displayed && (
  <div className="bg-white border border-[#E3DDCE] rounded-md p-5">
    <p className="text-[15px] font-semibold text-[#1C1B19] mb-3">
      {displayed.question}
    </p>
    <Answer text={displayed.answer} />
    <SourceList sources={displayed.sources} />
  </div>
)}

            <div ref={bottomRef} />
          </section>
        </div>
      </div>
    </main>
  );
}