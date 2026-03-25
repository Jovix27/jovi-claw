"use client";

import { useEffect, useState, useRef } from "react";
import { Socket } from "socket.io-client";
import { Monitor, X, Globe, Wifi, WifiOff } from "lucide-react";

interface ActionLog {
  time: string;
  action: string;
  detail: string;
}

interface RightPanelProps {
  socket: Socket | null;
  onClose?: () => void;
}

export default function RightPanel({ socket, onClose }: RightPanelProps) {
  const [actionLog, setActionLog] = useState<ActionLog[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [lastScreenshotTime, setLastScreenshotTime] = useState<number>(0);
  const [isAgentConnected, setIsAgentConnected] = useState(false);
  const [currentUrl, setCurrentUrl] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  // Listen for live screenshots
  useEffect(() => {
    if (!socket) return;
    const handler = (data: { imageData: string; timestamp: number }) => {
      setScreenshot(`data:image/png;base64,${data.imageData}`);
      setLastScreenshotTime(data.timestamp);
      setIsAgentConnected(true);
    };
    socket.on("screenshot", handler);
    return () => { socket.off("screenshot", handler); };
  }, [socket]);

  // Listen for action logs
  useEffect(() => {
    if (!socket) return;
    const handler = (log: ActionLog) => {
      setActionLog((prev) => [log, ...prev].slice(0, 100));
      // Try to extract URL from detail
      const urlMatch = log.detail?.match(/https?:\/\/[^\s]+/);
      if (urlMatch) setCurrentUrl(urlMatch[0]);
    };
    socket.on("action_log", handler);
    return () => { socket.off("action_log", handler); };
  }, [socket]);

  // Poll agent status
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      if (lastScreenshotTime > 0 && now - lastScreenshotTime < 8000) {
        setIsAgentConnected(true);
      } else if (lastScreenshotTime > 0) {
        setIsAgentConnected(false);
      }
    };
    const inv = setInterval(check, 3000);
    return () => clearInterval(inv);
  }, [lastScreenshotTime]);

  const stepCount = actionLog.length;

  return (
    <aside className="fixed inset-y-0 right-0 md:relative w-full md:w-[460px] h-full border-l border-white/[0.08] flex flex-col shrink-0 z-50 transition-transform"
      style={{ background: "#181818" }}
    >
      {/* ─── Header ─────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] shrink-0">
        <div className="flex items-center gap-2">
          <Monitor size={15} className="text-[#a0a0a0]" />
          <span className="text-sm font-medium text-white" style={{ fontFamily: "var(--font-caslon), serif" }}>Jovi&apos;s Computer</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Connection status */}
          <span className="text-xs text-[#888] flex items-center gap-1.5">
            {isAgentConnected ? (
              <>
                <Wifi size={12} className="text-green-400" />
                <span className="text-green-400">Connected</span>
              </>
            ) : (
              <>
                <WifiOff size={12} className="text-orange-400" />
                <span className="text-orange-400">Connecting…</span>
              </>
            )}
          </span>
          {/* Current activity */}
          {actionLog[0] && (
            <span className="text-xs text-[#555] flex items-center gap-1 max-w-[140px] truncate">
              <Globe size={11} /> {actionLog[0]?.action.includes("rowser") ? "Using browser" : "Using computer"}
            </span>
          )}
          {onClose && (
            <button onClick={onClose} className="text-[#666] hover:text-white transition-colors ml-1">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ─── Live Screenshot Viewport ───────────────── */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="w-full flex-1 min-h-[200px] bg-black flex flex-col overflow-hidden relative">
          {/* URL Bar */}
          {currentUrl && (
            <div className="h-8 bg-[#252525] flex items-center px-3 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Globe size={11} className="text-[#666] shrink-0" />
                <span className="text-[11px] text-[#888] truncate font-mono">{currentUrl}</span>
              </div>
            </div>
          )}

          {/* Screenshot or Waiting State */}
          <div className="flex-1 relative overflow-hidden">
            {screenshot ? (
              <img
                src={screenshot}
                alt="Live desktop view"
                className="w-full h-full object-contain"
                style={{ imageRendering: "auto" }}
              />
            ) : (
              <div className="flex-1 h-full flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-xl border border-white/10 flex items-center justify-center">
                  <Monitor size={20} className="text-[#555]" />
                </div>
                <p className="text-xs text-[#555]">
                  {isAgentConnected ? "Waiting for screenshot..." : "Waiting for PC agent to connect..."}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-[10px] text-[#444]">Listening</span>
                </div>
              </div>
            )}
          </div>

          {/* ─── Progress Bar ───────────────────────────── */}
          <div className="h-9 bg-[#1a1a1a] flex items-center gap-3 px-3 border-t border-white/[0.06] shrink-0">
            <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: screenshot ? "100%" : "33%",
                  background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                  animation: screenshot ? "none" : "pulse 2s ease-in-out infinite",
                }}
              />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide">
              <div className={`w-1.5 h-1.5 rounded-full ${screenshot ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`} />
              <span className={screenshot ? "text-green-400" : "text-yellow-400"}>
                {screenshot ? "live" : "waiting"}
              </span>
            </div>
          </div>
        </div>

        {/* ─── Step-by-Step Action Log ───────────────── */}
        <div className="border-t border-white/[0.06] max-h-[220px] overflow-y-auto px-3 py-2.5 flex flex-col gap-1.5">
          {actionLog.length === 0 ? (
            <p className="text-[11px] text-[#555] text-center py-3">No actions yet. Send a command to get started.</p>
          ) : (
            actionLog.slice(0, 15).map((log, i) => (
              <div key={i} className="flex items-start gap-2.5">
                {/* Step indicator */}
                <div className="flex flex-col items-center mt-0.5 shrink-0">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold ${
                    i === 0
                      ? "bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30"
                      : "bg-white/5 text-[#555]"
                  }`}>
                    {i === 0 ? "●" : "✓"}
                  </div>
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[12px] font-medium truncate ${i === 0 ? "text-white" : "text-[#aaa]"}`}>
                      {log.action}
                    </span>
                    <span className="text-[9px] text-[#555] shrink-0 font-mono tabular-nums">
                      {stepCount > 1 ? `${stepCount - i}/${stepCount}` : log.time}
                    </span>
                  </div>
                  <span className="text-[11px] text-[#666] truncate">{log.detail}</span>
                </div>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </aside>
  );
}
