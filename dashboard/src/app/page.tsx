"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { Menu } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import ChatInterface from "@/components/ChatInterface";
import SettingsModal from "@/components/SettingsModal";
import HistoryView from "@/components/HistoryView";
import RightPanel from "@/components/RightPanel";

export default function Home() {
  const [activeView, setActiveView]         = useState<"search" | "computer" | "agents" | "library" | "history">("search");
  const [computerMode, setComputerMode]     = useState(false);
  const [socket, setSocket]                 = useState<Socket | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);

  useEffect(() => {
    // Client-side only init
    setActiveThreadId(crypto.randomUUID());
  }, []);

  const handleComputerModeToggle = useCallback(() => {
    setComputerMode((prev) => !prev);
    setActiveView((prev) => (prev === "agents" ? "search" : "agents"));
  }, []);

  const handleNewThread = useCallback(() => {
    setActiveThreadId(crypto.randomUUID());
    setComputerMode(false);
    setActiveView("search");
  }, []);

  const handleThreadSelect = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    setComputerMode(false);
    setActiveView("search");
  }, []);

  const handleViewChange = useCallback((v: "search" | "computer" | "agents" | "library" | "history") => {
    setActiveView(v);
    setIsSidebarOpen(false); // Close sidebar on mobile after navigation
    if (v === "computer" || v === "agents") setComputerMode(true);
    else setComputerMode(false);
  }, []);

  // Auto-activate agent mode on backend when Computer mode toggles
  const agentModeCalledRef = useRef(false);
  useEffect(() => {
    if (!agentModeCalledRef.current) {
      agentModeCalledRef.current = true;
      return; // skip the initial render
    }

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

    const token = process.env.NEXT_PUBLIC_JOVI_SECRET || "";
    fetch(`${apiBase}/api/agent-mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled: computerMode }),
    }).catch(() => {});
  }, [computerMode]);

  return (
    <main className="flex h-screen w-full overflow-hidden" style={{ background: "#141414" }}>
      <Sidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        onNewThread={handleNewThread}
        computerMode={computerMode}
        onComputerModeToggle={handleComputerModeToggle}
        socket={socket}
        activeThreadId={activeThreadId}
        onThreadSelect={(t) => { handleThreadSelect(t); setIsSidebarOpen(false); }}
        onOpenSettings={() => { setIsSettingsOpen(true); setIsSidebarOpen(false); }}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        isDesktopCollapsed={isDesktopCollapsed}
        onToggleDesktopCollapse={() => setIsDesktopCollapsed(!isDesktopCollapsed)}
        onNavigateHome={() => { setActiveView("search"); setActiveThreadId(crypto.randomUUID()); setComputerMode(false); setIsDesktopCollapsed(false); setIsSidebarOpen(false); }}
      />

      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {isDesktopCollapsed && (
          <button
            onClick={() => setIsDesktopCollapsed(false)}
            className="hidden md:flex absolute top-4 left-4 z-40 p-2 rounded-md text-[#888] hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Open Sidebar"
          >
            <Menu size={20} />
          </button>
        )}
        {activeView === "history" ? (
          <HistoryView onThreadSelect={handleThreadSelect} />
        ) : (
          <ChatInterface
            computerMode={computerMode}
            onComputerModeToggle={handleComputerModeToggle}
            onSocketReady={setSocket}
            activeThreadId={activeThreadId}
            onMenuClick={() => setIsSidebarOpen(true)}
          />
        )}
      </div>

      {/* Conditionally render right panel split view */}
      {computerMode && (
        <RightPanel socket={socket} onClose={() => setComputerMode(false)} />
      )}

      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </main>
  );
}
