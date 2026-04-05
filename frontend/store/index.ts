"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProviderKey =
  | "ollama"
  | "openai"
  | "anthropic"
  | "cerebras"
  | "vercel";

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
  selectedProvider: ProviderKey;
  // Chat defaults
  useRag: boolean;
  useWebSearch: boolean;
  systemPrompt: string;
  // Appearance
  theme: "dark" | "light";
  // Provider credentials (stored in browser, sent as headers to backend)
  providerKeys: {
    openai: string;
    anthropic: string;
    cerebras: string;
    vercel: string;
    vercelGateway: string;
    tavily: string;
  };
  ollamaHost: string;
  // Custom model IDs per provider (user-managed additions)
  customModels: Record<string, string[]>;
  // Per-task model defaults
  defaultResearchModel: string;
  defaultResearchProvider: ProviderKey;
  // Auth
  authToken: string | null;
  authUser: { id: string; username: string; email: string; is_admin: boolean } | null;
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
  setProviderKey: (
    field: keyof PersistedSettings["providerKeys"],
    value: string
  ) => void;
  addCustomModel: (provider: string, modelId: string) => void;
  removeCustomModel: (provider: string, modelId: string) => void;
  setAuth: (token: string, user: { id: string; username: string; email: string; is_admin: boolean }) => void;
  clearAuth: () => void;
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
      providerKeys: {
        openai: "",
        anthropic: "",
        cerebras: "",
        vercel: "",
        vercelGateway: "",
        tavily: "",
      },
      ollamaHost: "",
      customModels: {
        ollama: [],
        openai: [],
        anthropic: [],
        cerebras: [],
        vercel: [],
      },
      defaultResearchModel: "",
      defaultResearchProvider: "ollama",
      authToken: null,
      authUser: null,

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
          selectedProvider: provider as ProviderKey,
        }),

      setSettings: (s) => set(s),

      toggleTheme: () =>
        set((state) => ({ theme: state.theme === "dark" ? "light" : "dark" })),

      setProviderKey: (field, value) =>
        set((state) => ({
          providerKeys: { ...state.providerKeys, [field]: value },
        })),

      addCustomModel: (provider, modelId) =>
        set((state) => {
          const current = state.customModels[provider] ?? [];
          if (current.includes(modelId)) return state;
          return {
            customModels: {
              ...state.customModels,
              [provider]: [...current, modelId],
            },
          };
        }),

      removeCustomModel: (provider, modelId) =>
        set((state) => ({
          customModels: {
            ...state.customModels,
            [provider]: (state.customModels[provider] ?? []).filter(
              (m) => m !== modelId
            ),
          },
        })),

      setAuth: (token, user) => set({ authToken: token, authUser: user }),
      clearAuth: () => set({ authToken: null, authUser: null }),
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
        providerKeys: state.providerKeys,
        ollamaHost: state.ollamaHost,
        customModels: state.customModels,
        defaultResearchModel: state.defaultResearchModel,
        defaultResearchProvider: state.defaultResearchProvider,
        authToken: state.authToken,
        authUser: state.authUser,
      }),
    }
  )
);
