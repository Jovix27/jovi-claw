"use client";

import { useState, useCallback, useEffect } from "react";
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
