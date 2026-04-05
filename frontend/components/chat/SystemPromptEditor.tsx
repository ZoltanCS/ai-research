"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, Sparkles } from "lucide-react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { useStore } from "@/store";

export default function SystemPromptEditor() {
  const { systemPrompt, setSettings } = useStore();
  const [open, setOpen] = useState(false);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div className="border-b border-zinc-800/80 flex-shrink-0">
        {/* Trigger row */}
        <Collapsible.Trigger className="w-full flex items-center gap-1.5 px-4 py-2 text-xs text-zinc-600 hover:text-zinc-400 hover:bg-zinc-900/40 transition-colors group">
          {open ? (
            <ChevronDown size={11} className="flex-shrink-0" />
          ) : (
            <ChevronRight size={11} className="flex-shrink-0" />
          )}
          <Sparkles size={11} className="flex-shrink-0" />
          <span>System prompt</span>
          {systemPrompt.trim() && (
            <span className="ml-2 px-1.5 py-px bg-zinc-800 text-zinc-500 rounded text-[10px] font-mono">
              {systemPrompt.length} chars
            </span>
          )}
        </Collapsible.Trigger>

        {/* Editor panel */}
        <Collapsible.Content className="data-[state=closed]:hidden">
          <div className="px-4 pb-3 pt-1">
            <textarea
              value={systemPrompt}
              onChange={(e) => setSettings({ systemPrompt: e.target.value })}
              placeholder="You are a helpful AI assistant. Customize the assistant's behaviour here…"
              rows={3}
              className="w-full resize-none text-xs bg-zinc-900 text-zinc-300 placeholder:text-zinc-600 rounded-lg border border-zinc-800 px-3 py-2.5 focus:outline-none focus:border-zinc-600 transition-colors font-mono leading-relaxed"
            />
          </div>
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}
