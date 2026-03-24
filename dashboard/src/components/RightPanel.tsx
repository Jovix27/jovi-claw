"use client";

import { useEffect, useState } from "react";
import { Socket } from "socket.io-client";
import { Monitor, X, Play, Square, Globe } from "lucide-react";

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

  useEffect(() => {
    if (!socket) return;
    const handler = (log: ActionLog) =>
      setActionLog((prev) => [log, ...prev].slice(0, 50));
    socket.on("action_log", handler);
    return () => {
      socket.off("action_log", handler);
    };
  }, [socket]);

  if (actionLog.length === 0) return null;

  return (
    <aside className="fixed inset-y-0 right-0 md:relative w-full md:w-[450px] h-full border-l border-white/10 flex flex-col bg-[#1e1e1e] shrink-0 z-50 transition-transform">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <Monitor size={16} className="text-[#a0a0a0]" />
          <span className="text-sm font-medium text-white">Jovi&apos;s Computer</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#888] flex items-center gap-1">
            <Globe size={12} /> Using browser
          </span>
          {onClose && (
            <button onClick={onClose} className="text-[#888] hover:text-white transition-colors">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Browser / Execution Area */}
      <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto min-h-0">
        {/* Fake Browser Window (Mimicking Manus) */}
        <div className="w-full h-[300px] bg-black rounded-lg border border-white/10 flex flex-col overflow-hidden shrink-0">
          {/* Browser Address Bar */}
          <div className="h-8 bg-[#2a2a2a] flex items-center px-3 border-b border-white/10">
            <div className="text-[11px] text-[#888] truncate">
              {actionLog[0]?.detail || "Waiting for execution..."}
            </div>
          </div>
          {/* Browser Content Area (Just a gradient placeholder for now since we don't have screencast yet) */}
          <div className="flex-1 bg-gradient-to-br from-[#111] to-[#222] flex items-center justify-center relative">
               {/* Terminal log trace floating over the browser placeholder */}
              <div className="absolute inset-x-0 bottom-0 top-auto bg-black/80 backdrop-blur pb-2 pt-8 px-4 flex flex-col gap-2 mask-linear">
                 <div className="flex items-center gap-2 text-blue-400">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-xs font-medium truncate">{actionLog[0]?.action || "Connecting..."}</span>
                 </div>
              </div>
          </div>
          
          {/* Progress Bar Area */}
          <div className="h-10 bg-[#1e1e1e] flex items-center gap-3 px-3 border-t border-white/10">
            <button className="text-[#555] hover:text-white"><Play size={14} fill="currentColor" /></button>
            <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 w-1/3 rounded-full animate-pulse" />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[#a0a0a0] font-medium tracking-wide string">
               <div className="w-1.5 h-1.5 rounded-full bg-green-500" /> Live
            </div>
          </div>
        </div>

        {/* Detailed Action Logs */}
        <div className="flex-1 flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-[#888] uppercase tracking-wider">Execution Pipeline</h3>
          <div className="flex flex-col gap-3 overflow-hidden">
            {actionLog.map((log, i) => (
              <div key={i} className="flex gap-3">
                 <div className="mt-1 flex flex-col items-center">
                    <div className={`w-2 h-2 rounded-full ${i === 0 ? "bg-blue-500 ring-2 ring-blue-500/30" : "bg-white/20"}`} />
                    {i !== actionLog.length - 1 && <div className="w-px h-full bg-white/10 mt-1" />}
                 </div>
                 <div className="flex flex-col flex-1 min-w-0 pb-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className={`text-[13px] font-medium truncate ${i === 0 ? "text-white" : "text-[#ccc]"}`}>{log.action}</span>
                        <span className="text-[10px] text-[#666] shrink-0 font-mono">{log.time}</span>
                    </div>
                    <span className="text-xs text-[#888] truncate mt-0.5">{log.detail}</span>
                 </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
