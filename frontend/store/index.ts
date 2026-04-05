"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  sources?: Array<{ title: string; url: string; snippet?: string }>;
}

interface PersistedSettings {
  // Model selection
  selectedModel: string;
  selectedProvider: "ollama" | "openai" | "anthropic" | "cerebras" | "vercel";
  // Chat defaults
  useRag: boolean;
  useWebSearch: boolean;
  systemPrompt: string;
  // Appearance
  theme: "dark" | "light";
  // Provider overrides (local override of env; backend still needs .env for actual auth)
  ollamaHost: string;
  // Per-task model defaults
  defaultResearchModel: string;
  defaultResearchProvider: "ollama" | "openai" | "anthropic" | "cerebras" | "vercel";
}

interface StoreState extends PersistedSettings {
  // Session state (not persisted)
  conversationId: string | null;
  messages: LocalMessage[];
  isStreaming: boolean;

  // ── Actions ────────────────────────────────────────────────────────────────
  addMessage: (msg: LocalMessage) => void;
  appendToLastMessage: (delta: string) => void;
  finalizeLastMessage: (sources?: LocalMessage["sources"]) => void;
  setConversationId: (id: string | null) => void;
  setIsStreaming: (v: boolean) => void;
  clearChat: () => void;
  setModel: (model: string, provider: string) => void;
  setSettings: (s: Partial<PersistedSettings>) => void;
  toggleTheme: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      // ── Persisted defaults ─────────────────────────────────────────────────
      selectedModel: "llama3.2",
      selectedProvider: "ollama",
      useRag: false,
      useWebSearch: false,
      systemPrompt: "",
      theme: "dark",
      ollamaHost: "",
      defaultResearchModel: "",
      defaultResearchProvider: "ollama",

      // ── Session defaults ───────────────────────────────────────────────────
      conversationId: null,
      messages: [],
      isStreaming: false,

      // ── Actions ────────────────────────────────────────────────────────────
      addMessage: (msg) =>
        set((state) => ({ messages: [...state.messages, msg] })),

      appendToLastMessage: (delta) =>
        set((state) => {
          const msgs = [...state.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") {
            msgs[msgs.length - 1] = { ...last, content: last.content + delta };
          }
          return { messages: msgs };
        }),

      finalizeLastMessage: (sources) =>
        set((state) => {
          const msgs = [...state.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant") {
            msgs[msgs.length - 1] = {
              ...last,
              isStreaming: false,
              sources: sources ?? last.sources,
            };
          }
          return { messages: msgs, isStreaming: false };
        }),

      setConversationId: (id) => set({ conversationId: id }),
      setIsStreaming: (v) => set({ isStreaming: v }),

      clearChat: () =>
        set({ messages: [], conversationId: null, isStreaming: false }),

      setModel: (model, provider) =>
        set({
          selectedModel: model,
          selectedProvider: provider as PersistedSettings["selectedProvider"],
        }),

      setSettings: (s) => set(s),

      toggleTheme: () =>
        set((state) => ({ theme: state.theme === "dark" ? "light" : "dark" })),
    }),
    {
      name: "localmind-store",
      partialize: (state) => ({
        selectedModel: state.selectedModel,
        selectedProvider: state.selectedProvider,
        useRag: state.useRag,
        useWebSearch: state.useWebSearch,
        systemPrompt: state.systemPrompt,
        theme: state.theme,
        ollamaHost: state.ollamaHost,
        defaultResearchModel: state.defaultResearchModel,
        defaultResearchProvider: state.defaultResearchProvider,
      }),
    }
  )
);
