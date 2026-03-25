"use client";

import { useState, useEffect, useRef, useCallback, type ReactElement, type ReactNode } from "react";
import { Send, Paperclip, Monitor, Mic, Loader2, Bot, User, Copy, Check, X, Menu } from "lucide-react";
import { io, Socket } from "socket.io-client";

// ─── Types ────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  text: string;
  imageFiles?: string[];
  status?: "running" | "done";
}

interface ChatInterfaceProps {
  computerMode: boolean;
  onComputerModeToggle: () => void;
  onSocketReady: (socket: Socket) => void;
  activeThreadId: string;
  onMenuClick?: () => void;
}

// ─── Suggestion data ──────────────────────────────────────

const COMPUTER_SUGGESTIONS = [
  "Open YouTube and search for sustainable buildings",
  "Take a screenshot of my screen and describe it",
  "Open my email and summarize unread messages",
  "Navigate to GitHub and check my latest PRs",
];

const SEARCH_SUGGESTIONS = [
  "Research NBC 2016 compliance for a 5-storey office building",
  "Write a project proposal for BuildSight AI",
  "Create a comparison table of eco building materials",
  "Draft a LinkedIn post about Green Build AI",
];

const CATEGORY_TABS = [
  { label: "For you",          suggestions: SEARCH_SUGGESTIONS  },
  { label: "Computer",         suggestions: COMPUTER_SUGGESTIONS },
  { label: "Build something",  suggestions: ["Build a landing page for EcoCraft Designer", "Create a REST API for BuildSight", "Set up a Python FastAPI project", "Generate a full-stack Next.js app"] },
  { label: "Research",         suggestions: ["IGBC AP exam preparation guide", "Latest YOLO v12 improvements", "Top 5 BIM tools for civil engineers", "Smart city IoT sensor architectures"] },
];

// ─── Markdown-lite renderer ────────────────────────────────
// Handles **bold**, `code`, ```code blocks```, and line breaks.

function renderMarkdown(text: string): ReactElement[] {
  const lines = text.split("\n");
  const elements: ReactElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <CodeBlock key={`code-${i}`} lang={lang} code={codeLines.join("\n")} />
      );
      i++;
      continue;
    }

    // Heading
    if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="text-sm font-semibold text-white mt-3 mb-1">{line.slice(4)}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="text-base font-bold text-white mt-4 mb-1">{line.slice(3)}</h2>);
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      // Inline formatting: **bold** and `code`
      elements.push(<p key={i} className="leading-relaxed">{inlineFormat(line)}</p>);
    }
    i++;
  }

  return elements;
}

function inlineFormat(text: string): (string | ReactElement)[] {
  const parts: (string | ReactElement)[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldIdx = remaining.indexOf("**");
    const codeIdx = remaining.indexOf("`");

    const first = Math.min(
      boldIdx === -1 ? Infinity : boldIdx,
      codeIdx  === -1 ? Infinity : codeIdx
    );

    if (first === Infinity) {
      parts.push(remaining);
      break;
    }

    parts.push(remaining.slice(0, first));
    remaining = remaining.slice(first);

    if (remaining.startsWith("**")) {
      const end = remaining.indexOf("**", 2);
      if (end !== -1) {
        parts.push(<strong key={key++} className="font-semibold text-white">{remaining.slice(2, end)}</strong>);
        remaining = remaining.slice(end + 2);
      } else {
        parts.push("**");
        remaining = remaining.slice(2);
      }
    } else if (remaining.startsWith("`")) {
      const end = remaining.indexOf("`", 1);
      if (end !== -1) {
        parts.push(<code key={key++} className="px-1 py-0.5 rounded text-xs font-mono bg-white/10 text-purple-300">{remaining.slice(1, end)}</code>);
        remaining = remaining.slice(end + 1);
      } else {
        parts.push("`");
        remaining = remaining.slice(1);
      }
    }
  }

  return parts;
}

// ─── Code block with copy button ────────────────────────

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-white/10">
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10">
        <span className="text-xs font-mono text-[#888]">{lang || "code"}</span>
        <button onClick={copy} className="flex items-center gap-1.5 text-xs text-[#888] hover:text-white transition-colors">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-sm font-mono text-[#c9d1d9] bg-[#0d1117] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────

export default function ChatInterface({
  computerMode,
  onComputerModeToggle,
  onSocketReady,
  activeThreadId,
  onMenuClick,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [remoteAgentOnline, setRemoteAgentOnline] = useState<boolean | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // Fetch backlog when thread changes
  useEffect(() => {
    if (!activeThreadId) return;
    
    setMessages([]);
    setInput("");
    setThinking(false);

    const token   = process.env.NEXT_PUBLIC_JOVI_SECRET || "";
    
    // Auto-detect production API if not set
    let apiBase = process.env.NEXT_PUBLIC_API_URL;
    if (apiBase && apiBase.includes("jovi-claw-production.up.railway.app") && !apiBase.includes("-6270")) {
        apiBase = "https://jovi-claw-production-6270.up.railway.app";
    }

    if (!apiBase && typeof window !== "undefined") {
      if (window.location.hostname.includes("vercel.app") || window.location.hostname === "jovi-ai.vercel.app") {
        apiBase = "https://jovi-claw-production-6270.up.railway.app";
      } else {
        apiBase = "http://localhost:3001";
      }
    } else if (!apiBase) {
      apiBase = "http://localhost:3001";
    }

    const fetchHistory = async () => {
      try {
        const res = await fetch(`${apiBase}/api/history/${activeThreadId}`, { 
            headers: { Authorization: `Bearer ${token}` } 
        });
        if (res.ok) {
          const d = await res.json();
          if (d.messages && Array.isArray(d.messages)) {
            setMessages(d.messages.map((m: any) => ({
                role: m.role,
                text: m.content,
                status: "done"
            })));
          }
        }
      } catch {}
    };

    fetchHistory();
  }, [activeThreadId]);

  // Poll Remote Agent Status
  useEffect(() => {
    // Auto-detect production API
    let apiBase = process.env.NEXT_PUBLIC_API_URL;
    if (!apiBase && typeof window !== "undefined") {
      if (window.location.hostname.includes("vercel.app") || window.location.hostname === "jovi-ai.vercel.app") {
        apiBase = "https://jovi-claw-production-6270.up.railway.app";
      } else {
        apiBase = "http://localhost:3001";
      }
    } else if (!apiBase) {
      apiBase = "http://localhost:3001";
    }

    const checkStatus = async () => {
      try {
        const res = await fetch(`${apiBase}/api/status`);
        if (res.ok) {
          const d = await res.json();
          setRemoteAgentOnline(d.agent_connected);
        }
      } catch {
        setRemoteAgentOnline(false);
      }
    };
    checkStatus();
    const inv = setInterval(checkStatus, 5000);
    return () => clearInterval(inv);
  }, []);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  // Socket connection
  useEffect(() => {
    const token   = process.env.NEXT_PUBLIC_JOVI_SECRET || "";

    // Auto-detect production API if not set
    let apiBase = process.env.NEXT_PUBLIC_API_URL;
    if (apiBase && apiBase.includes("jovi-claw-production.up.railway.app") && !apiBase.includes("-6270")) {
        apiBase = "https://jovi-claw-production-6270.up.railway.app";
    }

    if (!apiBase && typeof window !== "undefined") {
      if (window.location.hostname.includes("vercel.app") || window.location.hostname === "jovi-ai.vercel.app") {
        apiBase = "https://jovi-claw-production-6270.up.railway.app";
      } else {
        apiBase = "http://localhost:3001";
      }
    } else if (!apiBase) {
      apiBase = "http://localhost:3001";
    }

    const s = io(apiBase, { 
      auth: { token },
      transports: ["websocket"] 
    });

    s.on("connect", () => {
      console.log("✅ Jovi Dashboard connected");
      onSocketReady(s);
    });

    s.on("status", (d: { type: "thinking" | "idle" }) => {
      setThinking(d.type === "thinking");
    });

    s.on("progress", (event: { type: string; tool?: string }) => {
      if (event.type === "tool_result" && event.tool) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: `⚙️ Running ${event.tool}…`, status: "running" },
        ]);
      }
    });

    s.on("message", (msg: { text: string; imageFiles?: string[]; role?: string }) => {
      setMessages((prev) => [
        ...prev.filter((m) => m.status !== "running"),
        { role: "assistant", text: msg.text, imageFiles: msg.imageFiles, status: "done" },
      ]);
      setThinking(false);
    });

    setSocket(s);
    return () => { s.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const token   = process.env.NEXT_PUBLIC_JOVI_SECRET || "";
  
  // Auto-detect production API
  let apiBase = process.env.NEXT_PUBLIC_API_URL;
  if (!apiBase && typeof window !== "undefined") {
    if (window.location.hostname.includes("vercel.app") || window.location.hostname === "jovi-claw.vercel.app") {
      apiBase = "https://jovi-claw-production-6270.up.railway.app";
    } else {
      apiBase = "http://localhost:3001";
    }
  } else if (!apiBase) {
    apiBase = "http://localhost:3001";
  }

  const send = useCallback(async (files: File[] = []) => {
    if ((!input.trim() && files.length === 0) || !socket || thinking) return;

    // Convert files to base64
    const filePromises = files.map(f => {
      return new Promise<{name: string, type: string, data: string}>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
           resolve({ name: f.name, type: f.type, data: e.target?.result as string });
        };
        reader.readAsDataURL(f);
      });
    });

    const base64Files = await Promise.all(filePromises);

    // If computer mode — prefix as computer_use_task instruction
    const text = computerMode
      ? `[COMPUTER USE] ${input.trim()}`
      : input.trim();

    setMessages((prev) => [...prev, { role: "user", text: input.trim() }]);
    socket.emit("message", { text, files: base64Files, threadId: activeThreadId });
    setInput("");
    inputRef.current?.focus();
  }, [input, socket, thinking, computerMode, activeThreadId]);

  const handleSuggestion = (suggestion: string) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex-1 flex flex-col h-full min-w-0" style={{ background: "#141414" }}>
      
      {/* Mobile Top Bar */}
      <header className="md:hidden flex items-center justify-between px-4 h-14 border-b border-white/[0.06] shrink-0 sticky top-0 z-30 bg-[#141414]/90 backdrop-blur-md">
        <button 
          onClick={onMenuClick}
          className="p-2 -ml-2 text-[#888] hover:text-white transition-colors"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <span
            className="text-xl text-[#e0e0e0]"
            style={{ letterSpacing: "-0.01em", fontFamily: "var(--font-caslon), serif" }}
          >
            Jovi
          </span>
          <span className={`w-1.5 h-1.5 rounded-full mt-1 ${remoteAgentOnline ? 'bg-green-500' : 'bg-red-500/40'}`} />
        </div>
        <div className="w-8" /> {/* Spacer */}
      </header>

      {/* ── Empty state ───────────────────────────────────── */}
      {!hasMessages && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">

          {/* Wordmark */}
          <h1
            className="text-5xl text-[#e0e0e0] mb-8 select-none"
            style={{ letterSpacing: "-0.02em", fontFamily: "var(--font-caslon), serif" }}
          >
            Jovi
          </h1>

          {/* Input */}
          <div className="w-full max-w-2xl px-4 md:px-0">
            <InputBox
              inputRef={inputRef}
              value={input}
              onChange={setInput}
              onSend={send}
              thinking={thinking}
              computerMode={computerMode}
              onComputerModeToggle={onComputerModeToggle}
              wide
            />
          </div>

          {/* Try Computer card */}
          <div className="w-full max-w-2xl mt-6 rounded-2xl border border-white/[0.08] overflow-hidden" style={{ background: "#1a1a1a" }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
              <Monitor size={14} className="text-[#888]" />
              <span className="text-sm text-[#888] font-medium">Try Computer</span>
            </div>

            {/* Tabs */}
            <div className="flex gap-0 border-b border-white/[0.06] px-4 overflow-x-auto">
              {CATEGORY_TABS.map((tab, i) => (
                <button
                  key={i}
                  onClick={() => setActiveTab(i)}
                  className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                    activeTab === i
                      ? "border-white text-white"
                      : "border-transparent text-[#666] hover:text-[#aaa]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Suggestions */}
            <div className="flex flex-col divide-y divide-white/[0.04]">
              {CATEGORY_TABS[activeTab].suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestion(s)}
                  className="flex items-center justify-between px-4 py-3 text-sm text-[#bbb] hover:bg-white/5 hover:text-white transition-colors text-left group"
                >
                  <span>{s}</span>
                  <Send size={12} className="shrink-0 ml-4 opacity-0 group-hover:opacity-40 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Thread view ────────────────────────────────────── */}
      {hasMessages && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
            
            {computerMode && remoteAgentOnline === false && (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                  <Monitor size={16} className="text-red-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-200">Remote PC Offline</p>
                  <p className="text-xs text-red-300/60">Commands will not execute until you run <code className="bg-red-500/20 px-1 rounded">npm run remote-agent</code> on your PC.</p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className="flex gap-4 animate-fade-in justify-start w-full"
              >
                {msg.role === "assistant" ? (
                  <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot size={14} className="text-purple-400" />
                  </div>
                ) : (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold text-white">
                    B
                  </div>
                )}

                <div
                  className={`flex-1 min-w-0 ${
                    msg.role === "user"
                      ? "py-0.5 text-[15px] text-[#e0e0e0]"
                      : msg.status === "running"
                      ? "py-0.5 text-[15px] text-[#666] italic"
                      : "py-0.5 text-[15px] text-[#ccc]"
                  }`}
                >
                  {msg.status === "running" ? (
                    <span className="flex items-center gap-2">
                      <Loader2 size={12} className="animate-spin text-purple-400" />
                      {msg.text}
                    </span>
                  ) : msg.role === "assistant" ? (
                    <div className="space-y-1">{renderMarkdown(msg.text)}</div>
                  ) : (
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                  )}

                  {/* Images from vision / computer use */}
                  {msg.imageFiles && msg.imageFiles.length > 0 && (
                    <div className="mt-4 flex flex-col gap-2">
                      {msg.imageFiles.map((img, idx) => (
                        <img
                          key={idx}
                          src={`${apiBase}/api/proxy-image?path=${encodeURIComponent(img)}&token=${encodeURIComponent(token)}`}
                          alt="Result"
                          className="rounded-xl border border-white/10 w-full max-w-xl h-auto"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Thinking indicator */}
            {thinking && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0">
                  <Bot size={14} className="text-purple-400" />
                </div>
                <div className="flex items-center gap-2 py-2">
                  <span className="flex gap-1">
                    {[0, 1, 2].map((d) => (
                      <span
                        key={d}
                        className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce"
                        style={{ animationDelay: `${d * 0.15}s` }}
                      />
                    ))}
                  </span>
                  <span className="text-xs text-[#555]">Jovi is thinking…</span>
                </div>
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </div>
      )}

      {/* ── Sticky input (active state) ─────────────────── */}
      {hasMessages && (
        <div className="px-6 pb-6 pt-2">
          <div className="max-w-3xl mx-auto">
            <InputBox
              inputRef={inputRef}
              value={input}
              onChange={setInput}
              onSend={send}
              thinking={thinking}
              computerMode={computerMode}
              onComputerModeToggle={onComputerModeToggle}
              wide={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared input box ─────────────────────────────────────

interface InputBoxProps {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSend: (files?: File[]) => void;
  thinking: boolean;
  computerMode: boolean;
  onComputerModeToggle: () => void;
  wide: boolean;
}

function InputBox({ inputRef, value, onChange, onSend, thinking, computerMode, onComputerModeToggle, wide }: InputBoxProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isListening, setIsListening] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const submit = () => {
    if ((!value.trim() && files.length === 0) || thinking) return;
    onSend(files);
    setFiles([]);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const toggleVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input is not supported in this browser.");
      return;
    }
    if (isListening) {
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (e: any) => {
      let finalTranscript = '';
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
      }
      if (finalTranscript) {
        onChange(value + (value ? ' ' : '') + finalTranscript);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    
    recognition.start();
  };

  return (
    <div className={`w-full ${wide ? "max-w-3xl" : ""}`}>
      <div
        className={`rounded-2xl border transition-all ${
          computerMode ? "border-purple-500/40 shadow-[0_0_15px_rgba(168,85,247,0.1)]" : "border-[#333] hover:border-[#444] focus-within:border-[#555] focus-within:bg-[#222]"
        }`}
        style={{ background: "#1c1c1c" }}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-4 pb-1">
            {files.map((file, i) => (
              <div key={i} className="flex items-center gap-2 bg-[#2a2a2a] rounded-lg pl-3 pr-2 py-1.5 border border-white/10 group">
                <span className="text-xs text-[#ccc] truncate max-w-[120px] font-medium">{file.name}</span>
                <button onClick={() => removeFile(i)} className="text-[#666] hover:text-white transition-colors p-0.5 rounded-md hover:bg-white/10">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={inputRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKey}
          placeholder="Ask Jovi..."
          rows={1}
          className="w-full bg-transparent text-white text-[15px] placeholder:text-[#666] px-4 pt-3.5 pb-2 resize-none outline-none leading-relaxed"
          style={{ minHeight: "52px", maxHeight: "200px", fontFamily: "Inter, sans-serif" }}
        />

        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <div className="flex items-center gap-1">
            <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*,.pdf,.docx,.txt" onChange={handleFileChange} />
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-xl text-[#888] hover:bg-white/5 hover:text-white transition-colors"
              title="Attach (Images, PDFs, TXT)"
            >
              <Paperclip size={18} />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onComputerModeToggle}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors mr-1 ${
                computerMode
                  ? "bg-purple-500/20 text-purple-300"
                  : "text-[#888] hover:bg-white/5 hover:text-white"
              }`}
            >
              <Monitor size={14} strokeWidth={2.5} />
              Computer
            </button>

            <button 
              onClick={toggleVoice}
              className={`p-2 rounded-xl transition-colors ${
                isListening ? "text-red-400 bg-red-400/10 animate-pulse" : "text-[#888] hover:bg-white/5 hover:text-white"
              }`}
              title="Voice Input"
            >
              <Mic size={18} />
            </button>

            <button
              onClick={submit}
              disabled={(!value.trim() && files.length === 0) || thinking}
              className="w-8 h-8 ml-1 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: (value.trim() || files.length > 0) && !thinking ? "white" : "#333" }}
            >
              {thinking
                ? <Loader2 size={16} className="animate-spin text-[#888]" />
                : <Send size={16} className={(value.trim() || files.length > 0) ? "text-black" : "text-[#888]"} strokeWidth={2.5} />}
            </button>
          </div>
        </div>
      </div>

      {wide && (
        <p className="text-center text-[11px] text-[#555] mt-3 tracking-widest uppercase font-medium">
          Jovi Claw — Autonomous AI Operating System
        </p>
      )}
    </div>
  );
}
