"use client";

import { useState, useEffect } from "react";
import { History, MessageSquare, Clock } from "lucide-react";

interface HistoryViewProps {
  onThreadSelect: (id: string) => void;
}

export default function HistoryView({ onThreadSelect }: HistoryViewProps) {
  const [threads, setThreads] = useState<Array<{ thread_id: string; title: string; updated_at: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchThreads = async () => {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
        const token = process.env.NEXT_PUBLIC_JOVI_SECRET || "";
        const res = await fetch(`${apiBase}/api/history`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const d = await res.json();
          setThreads(d.threads || []);
        }
      } catch (err) {
        console.error("Failed to fetch history:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchThreads();
  }, []);
  return (
    <div className="flex-1 flex flex-col h-full bg-[#141414] overflow-y-auto w-full">
      <div className="max-w-4xl mx-auto w-full px-8 py-12">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
            <History size={20} className="text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Chat History</h1>
        </div>

        {threads.length === 0 ? (
          <div className="text-center py-20 text-[#666]">
            No past conversations found.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {threads.map((t) => (
              <button
                key={t.thread_id}
                onClick={() => onThreadSelect(t.thread_id)}
                className="flex flex-col text-left p-5 rounded-2xl bg-[#1c1c1c] border border-white/[0.06] hover:border-white/20 hover:bg-[#222] transition-colors group"
              >
                <div className="flex items-start gap-3 w-full mb-3">
                  <MessageSquare size={16} className="text-[#666] shrink-0 mt-0.5 group-hover:text-purple-400 transition-colors" />
                  <span className="text-[15px] font-medium text-[#e0e0e0] flex-1 line-clamp-2 leading-relaxed">
                    {t.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-[#555] mt-auto">
                  <Clock size={12} />
                  {new Date(t.updated_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
