"use client";

import {
  useRef,
  useState,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { Send, Square, Paperclip, Globe, BookOpen, X, ChevronDown } from "lucide-react";
import { useStore } from "@/store";
import { uploadDocument } from "@/lib/api";

interface Props {
  onSubmit: (input: string) => void;
  onStop: () => void;
}

// ── Personality quick-switcher ────────────────────────────────────────────────

function PersonalityBadge() {
  const { personalities, activePersonalityId, setActivePersonality } = useStore();
  const [open, setOpen] = useState(false);

  const active = personalities?.find((p) => p.id === activePersonalityId) ?? personalities?.[0];

  if (!active) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 rounded-full text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        title="Switch personality"
      >
        <span className="text-sm leading-none">{active.avatar}</span>
        <span className="max-w-[80px] truncate">{active.name}</span>
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          {/* Dropdown */}
          <div className="absolute bottom-full mb-2 left-0 z-20 w-56 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl overflow-hidden">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-widest border-b border-zinc-800">
              Personality
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {personalities?.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setActivePersonality(p.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                    p.id === activePersonalityId
                      ? "bg-blue-950/40 text-blue-200"
                      : "text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  <span className="text-base leading-none flex-shrink-0">{p.avatar}</span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-zinc-500 truncate">{p.description}</div>
                  </div>
                  {p.id === activePersonalityId && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── InputArea ─────────────────────────────────────────────────────────────────

export default function InputArea({ onSubmit, onStop }: Props) {
  const { isStreaming, useRag, useWebSearch, setSettings } = useStore();
  const [input, setInput] = useState("");
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const submit = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    onSubmit(input);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, isStreaming, onSubmit]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    autoResize(e.target);
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadDocument(file);
      setUploadedFile(file.name);
      // Enable RAG automatically after upload
      setSettings({ useRag: true });
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
    e.target.value = "";
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-shrink-0 border-t border-zinc-800/80 bg-[#0a0a0a] px-4 py-3">
      <div className="max-w-3xl mx-auto space-y-2">
        {/* Attached file badge */}
        {uploadedFile && (
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 pl-1">
            <Paperclip size={11} className="text-zinc-500" />
            <span className="truncate max-w-[280px]">{uploadedFile}</span>
            <button
              onClick={() => setUploadedFile(null)}
              className="text-zinc-600 hover:text-zinc-300 transition-colors ml-0.5"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {/* Main input row */}
        <div className="flex items-end gap-2 bg-zinc-900/80 rounded-2xl border border-zinc-800 px-3 py-2.5 focus-within:border-zinc-600 transition-colors">
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Attach document (PDF, DOCX, TXT, MD)"
            className="flex-shrink-0 mb-px p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 rounded-lg transition-colors"
          >
            <Paperclip size={15} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything…"
            rows={1}
            disabled={isStreaming && input === ""}
            className="flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none leading-6 py-px max-h-48 disabled:opacity-50"
          />

          {/* Toggle: web search */}
          <button
            onClick={() => setSettings({ useWebSearch: !useWebSearch })}
            title={useWebSearch ? "Disable web search" : "Enable web search"}
            className={`flex-shrink-0 mb-px p-1.5 rounded-lg transition-colors ${
              useWebSearch
                ? "text-blue-400 bg-blue-950/60"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            <Globe size={15} />
          </button>

          {/* Toggle: RAG */}
          <button
            onClick={() => setSettings({ useRag: !useRag })}
            title={useRag ? "Disable document search" : "Enable document search (RAG)"}
            className={`flex-shrink-0 mb-px p-1.5 rounded-lg transition-colors ${
              useRag
                ? "text-emerald-400 bg-emerald-950/60"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            <BookOpen size={15} />
          </button>

          {/* Send / Stop */}
          {isStreaming ? (
            <button
              onClick={onStop}
              title="Stop generation"
              className="flex-shrink-0 mb-px p-1.5 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-white transition-colors"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim()}
              title="Send (Enter)"
              className="flex-shrink-0 mb-px p-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-lg text-white transition-colors"
            >
              <Send size={13} />
            </button>
          )}
        </div>

        {/* Bottom row: personality badge + hint */}
        <div className="flex items-center justify-between px-1">
          <PersonalityBadge />
          <p className="text-[11px] text-zinc-700">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
    </div>
  );
}
