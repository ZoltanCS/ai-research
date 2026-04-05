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

export interface Personality {
  id: string;
  name: string;
  description: string;
  avatar: string;           // emoji
  systemPrompt: string;
  tags: string[];           // e.g. ["formal", "technical", "concise"]
  isDefault: boolean;       // built-in, cannot be deleted
  createdAt: string;        // ISO date string
}

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
    exa: string;
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
  // Personalities
  personalities: Personality[];
  activePersonalityId: string | null;
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
  // Personality actions
  addPersonality: (p: Personality) => void;
  updatePersonality: (id: string, updates: Partial<Personality>) => void;
  deletePersonality: (id: string) => void;
  setActivePersonality: (id: string | null) => void;
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
        exa: "",
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
      personalities: [
        {
          id: "default",
          name: "LocalMind",
          description: "The default helpful research assistant",
          avatar: "🧠",
          systemPrompt: "",
          tags: ["balanced", "research"],
          isDefault: true,
          createdAt: new Date().toISOString(),
        },
        {
          id: "researcher",
          name: "Deep Researcher",
          description: "Exhaustive, citation-heavy academic research style",
          avatar: "🔬",
          systemPrompt: "You are an expert academic researcher. Provide exhaustive, well-structured analysis with citations. Use headings, bullet points, and numbered lists. Always cite sources. Be thorough rather than brief. Challenge assumptions and present multiple perspectives.",
          tags: ["academic", "thorough", "citations"],
          isDefault: true,
          createdAt: new Date().toISOString(),
        },
        {
          id: "coder",
          name: "Code Expert",
          description: "Concise technical answers with working code",
          avatar: "💻",
          systemPrompt: "You are a senior software engineer. Provide concise, working code solutions. Prefer showing code over explaining theory. Use modern best practices. When debugging, identify root causes. Include edge cases and error handling in your solutions.",
          tags: ["technical", "concise", "code"],
          isDefault: true,
          createdAt: new Date().toISOString(),
        },
        {
          id: "creative",
          name: "Creative Writer",
          description: "Imaginative, vivid, and expressive writing",
          avatar: "✍️",
          systemPrompt: "You are a creative writer with a vivid imagination. Write with flair, emotion, and originality. Use rich descriptions, varied sentence structure, and compelling narratives. Embrace metaphor, subtext, and literary techniques. Be bold and original.",
          tags: ["creative", "expressive", "writing"],
          isDefault: true,
          createdAt: new Date().toISOString(),
        },
        {
          id: "teacher",
          name: "Patient Teacher",
          description: "Explains complex topics simply with examples",
          avatar: "📚",
          systemPrompt: "You are a patient, encouraging teacher. Break down complex topics into simple steps. Use relatable analogies and concrete examples. Check understanding by summarizing key points. Never make the learner feel stupid. Celebrate progress.",
          tags: ["educational", "simple", "examples"],
          isDefault: true,
          createdAt: new Date().toISOString(),
        },
        {
          id: "devil-advocate",
          name: "Devil's Advocate",
          description: "Challenges ideas and presents counter-arguments",
          avatar: "😈",
          systemPrompt: "You are a sharp critical thinker who challenges ideas constructively. Question assumptions, identify weaknesses in arguments, and present strong counter-arguments. Push back on claims that lack evidence. Help the user stress-test their ideas.",
          tags: ["critical", "debate", "challenging"],
          isDefault: true,
          createdAt: new Date().toISOString(),
        },
      ],
      activePersonalityId: "default",

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

      addPersonality: (p) =>
        set((state) => ({ personalities: [...state.personalities, p] })),

      updatePersonality: (id, updates) =>
        set((state) => ({
          personalities: state.personalities.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),

      deletePersonality: (id) =>
        set((state) => ({
          personalities: state.personalities.filter((p) => p.id !== id),
          activePersonalityId:
            state.activePersonalityId === id ? "default" : state.activePersonalityId,
        })),

      setActivePersonality: (id) => set({ activePersonalityId: id }),
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
        personalities: state.personalities,
        activePersonalityId: state.activePersonalityId,
      }),
    }
  )
);
