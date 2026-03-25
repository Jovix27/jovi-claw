"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Search,
  Monitor,
  Plus,
  History,
  Settings,
  Bot,
  Library,
  X,
} from "lucide-react";

interface SidebarProps {
  activeView: "search" | "computer" | "agents" | "library" | "history";
  onViewChange: (v: "search" | "computer" | "agents" | "library" | "history") => void;
  onNewThread: () => void;
  computerMode: boolean;
  onComputerModeToggle: () => void;
  socket: any;
  activeThreadId: string;
  onThreadSelect: (t: string) => void;
  onOpenSettings: () => void;
  isOpen: boolean;
  onClose: () => void;
  isDesktopCollapsed: boolean;
  onToggleDesktopCollapse: () => void;
  onNavigateHome: () => void;
}

const MAIN_NAV = [
  { id: "search",   icon: Search,  label: "Search"   },
  { id: "computer", icon: Monitor, label: "Computer" },
  { id: "agents",   icon: Bot,     label: "Agents"   },
  { id: "library",  icon: Library, label: "Library"  },
] as const;

const SECONDARY_NAV = [
  { id: "history",  icon: History,    label: "History"  },
] as const;

export default function Sidebar({
  activeView,
  onViewChange,
  onNewThread,
  computerMode,
  onComputerModeToggle,
  socket,
  activeThreadId,
  onThreadSelect,
  onOpenSettings,
  isOpen,
  onClose,
  isDesktopCollapsed,
  onToggleDesktopCollapse,
  onNavigateHome,
}: SidebarProps) {
  const [threads, setThreads] = useState<Array<{thread_id: string; title: string; updated_at: number}>>([]);

  // Fetch threads
  const fetchThreads = useCallback(async () => {
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const token = process.env.NEXT_PUBLIC_JOVI_SECRET || "";
      const res = await fetch(`${apiBase}/api/history`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        setThreads(d.threads || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchThreads();
    const id = setInterval(fetchThreads, 15000); // refresh every 15s
    return () => clearInterval(id);
  }, [fetchThreads, activeThreadId]);

  return (
    <aside
      className={`fixed md:relative flex flex-col h-full shrink-0 border-r border-white/[0.06] z-50 transition-all duration-300 ease-in-out overflow-hidden ${
        isOpen ? "translate-x-0 w-64" : "-translate-x-full md:translate-x-0"
      } ${
        !isOpen && isDesktopCollapsed ? "md:w-0 md:opacity-0 md:border-none md:-ml-px" : "md:w-64"
      }`}
      style={{ background: "#111111" }}
    >
      {/* Brand & Mobile Close */}
      <div className="px-4 pt-5 pb-3 flex items-center justify-between shrink-0">
        <button
          onClick={() => { onNavigateHome(); onClose(); }}
          className="flex items-center hover:opacity-80 transition-opacity"
          aria-label="Go home"
        >
          <span
            className="text-[#e0e0e0] select-none"
            style={{ letterSpacing: "-0.01em", fontFamily: "var(--font-caslon), serif", fontSize: "26px" }}
          >
            Jovi
          </span>
        </button>
        <button
          onClick={onClose}
          className="md:hidden p-1 -mr-1 text-[#888] hover:text-white transition-colors"
          aria-label="Close sidebar"
        >
          <X size={20} />
        </button>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-col gap-0.5 px-2 mt-2">
        {MAIN_NAV.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => onViewChange(id as "search" | "computer" | "agents" | "library")}
            className={`flex items-center gap-3 w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeView === id
                ? "bg-white/10 text-white"
                : "text-[#888] hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon size={16} strokeWidth={1.8} />
            {label}
            {id === "computer" && computerMode && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-purple-400" />
            )}
            {id === "agents" && (
              <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 uppercase tracking-widest">New</span>
            )}
          </button>
        ))}

        <div className="h-2" />

        {/* New chat */}
        <button
          onClick={onNewThread}
          className="flex items-center gap-3 w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-[#c9d1d9] hover:bg-white/5 hover:text-white transition-colors"
        >
          <Plus size={16} strokeWidth={1.8} className="text-[#888]" />
          New chat
        </button>

        <div className="h-1" />

        {/* Secondary nav */}
        {SECONDARY_NAV.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => {
              if (id === "history") onViewChange("history");
            }}
            className={`flex items-center gap-3 w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeView === id
                ? "bg-white/10 text-white"
                : "text-[#888] hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon size={16} strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </nav>

      {/* Recent Threads */}
      {threads.length > 0 && (
        <div className="px-4 flex-1 overflow-y-auto mt-4 mb-2 relative" style={{ minHeight: "100px" }}>
          <p className="text-[10px] text-[#555] uppercase tracking-widest font-semibold mb-2 pl-1">
            Recent
          </p>
          <div className="flex flex-col gap-0.5">
            {threads.map((t) => (
              <button
                key={t.thread_id}
                onClick={() => onThreadSelect(t.thread_id)}
                className={`flex text-left px-2 py-1.5 rounded-lg transition-colors overflow-hidden ${
                  activeThreadId === t.thread_id 
                    ? "bg-white/10" 
                    : "hover:bg-white/5"
                }`}
              >
                <span className={`text-xs truncate w-full ${activeThreadId === t.thread_id ? "text-white font-medium" : "text-[#888] hover:text-[#ccc]"}`}>
                  {t.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom — Settings + Boss Avatar */}
      <div className="mt-auto px-4 pb-5 flex flex-col gap-3">

        <button 
          onClick={onOpenSettings}
          className="flex items-center gap-2 text-xs text-[#666] hover:text-white transition-colors"
        >
          <Settings size={14} strokeWidth={1.6} />
          Settings
        </button>

        {/* Boss avatar */}
        <div className="flex items-center gap-2.5 pt-1">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-xs font-bold text-white">
            B
          </div>
          <span className="text-sm font-medium text-[#aaa]">Boss</span>
        </div>
      </div>
    </aside>
  );
}
