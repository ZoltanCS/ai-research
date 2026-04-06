"use client";

import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";

// ── Parser ─────────────────────────────────────────────────────────────────────

export interface ParsedContent {
  thinkContent: string | null;
  mainContent: string;
  isThinkingComplete: boolean;
}

/**
 * Extracts <think>…</think> or <thinking>…</thinking> blocks from streamed
 * model output (DeepSeek-R1, QwQ, Qwen3-thinking, etc.).
 */
export function parseChainOfThought(raw: string): ParsedContent {
  // Complete block: <think>…</think>
  const full = raw.match(/^<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>([\s\S]*)$/i);
  if (full) {
    return {
      thinkContent: full[1].trim(),
      mainContent: full[2].trim(),
      isThinkingComplete: true,
    };
  }
  // Incomplete block — still streaming thinking
  const open = raw.match(/^<think(?:ing)?>([\s\S]*)$/i);
  if (open) {
    return {
      thinkContent: open[1],
      mainContent: "",
      isThinkingComplete: false,
    };
  }
  return { thinkContent: null, mainContent: raw, isThinkingComplete: true };
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  thinkContent: string;
  isComplete: boolean;
  isStreaming?: boolean;
}

export function ChainOfThought({ thinkContent, isComplete, isStreaming }: Props) {
  const [open, setOpen] = useState(false);
  const stillThinking = isStreaming && !isComplete;

  return (
    <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <Brain
          size={13}
          className={`flex-shrink-0 ${stillThinking ? "text-purple-400 animate-pulse" : "text-purple-500"}`}
        />
        <span className="text-xs font-medium text-zinc-500">
          {stillThinking ? "Thinking…" : "Reasoning"}
        </span>
        {stillThinking && (
          <span className="flex gap-0.5 ml-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1 h-1 rounded-full bg-purple-500 animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
        )}
        <ChevronDown
          size={12}
          className={`ml-auto text-zinc-600 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Collapsible content */}
      <div
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: open ? "600px" : "0px" }}
      >
        <div className="px-3 pb-3 pt-1 border-t border-zinc-800">
          <pre className="text-[11px] leading-relaxed text-zinc-500 font-mono whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
            {thinkContent || "…"}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default ChainOfThought;
