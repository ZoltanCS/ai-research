"use client";

import { Settings, RotateCcw } from "lucide-react";
import ModelSelector from "./ModelSelector";
import { useStore } from "@/store";

export default function TopBar() {
  const { clearChat, isStreaming } = useStore();

  return (
    <div className="flex items-center justify-between h-12 px-3 border-b border-zinc-800/80 bg-[#0a0a0a] flex-shrink-0">
      <ModelSelector />

      <div className="flex items-center gap-1">
        {/* New chat shortcut */}
        <button
          onClick={clearChat}
          disabled={isStreaming}
          title="New chat"
          className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 rounded-lg transition-colors"
        >
          <RotateCcw size={14} />
        </button>

        {/* Settings placeholder */}
        <button
          title="Settings"
          className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
