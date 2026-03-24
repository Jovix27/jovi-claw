"use client";

import { useState, useEffect } from "react";
import { X, Save, Brain, Check } from "lucide-react";

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
        const token = process.env.NEXT_PUBLIC_JOVI_SECRET || "";
        const res = await fetch(`${apiBase}/api/settings`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const d = await res.json();
          setInstructions(d.customInstructions || "");
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const token = process.env.NEXT_PUBLIC_JOVI_SECRET || "";
      const res = await fetch(`${apiBase}/api/settings`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ customInstructions: instructions })
      });

      if (res.ok) {
        setSaved(true);
        setTimeout(() => {
          setSaved(false);
          onClose();
        }, 1000);
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div 
        className="w-full max-w-lg rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden" 
        style={{ background: "#1c1c1c" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Brain size={18} className="text-purple-400" />
            <h2 className="text-base font-semibold text-white">Memory & Settings</h2>
          </div>
          <button 
            onClick={onClose}
            className="text-[#888] hover:text-white transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-[#e0e0e0] mb-2">
              Custom Instructions
            </label>
            <p className="text-xs text-[#888] mb-3 leading-relaxed">
              What would you like Jovi to know about you to provide better responses? 
              (e.g., job title, specific formatting preferences, or general tone). 
              This will be injected into Jovi's core memory.
            </p>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              disabled={loading}
              placeholder={loading ? "Loading..." : "E.g., I'm a senior developer. Always output code in Python and keep explanations brief."}
              className="w-full h-40 bg-[#111] border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-[#555] focus:border-purple-500/50 focus:outline-none resize-none transition-colors"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/[0.06] flex justify-end gap-3 bg-[#111]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[#888] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading || saving}
            className="flex items-center justify-center gap-2 px-6 py-2 rounded-lg text-sm font-semibold bg-white text-black hover:bg-[#e0e0e0] transition-colors disabled:opacity-50"
            style={{ minWidth: "100px" }}
          >
            {saving ? (
              <span className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
            ) : saved ? (
              <>
                <Check size={16} /> Saved
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
