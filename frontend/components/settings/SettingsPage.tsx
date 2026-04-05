"use client";

import { useEffect, useState } from "react";
import {
  Sun,
  Moon,
  Server,
  Zap,
  Brain,
  Eye,
  EyeOff,
  Trash2,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ChevronRight,
} from "lucide-react";
import { useStore } from "@/store";
import {
  getProviderStatus,
  getConversations,
  deleteConversation,
  getDocuments,
  deleteDocument,
  getModels,
  type ProviderStatus,
  type ModelInfo,
} from "@/lib/api";

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        {description && (
          <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-300">{label}</p>
        {hint && <p className="text-xs text-zinc-600 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

// ── Masked key field ──────────────────────────────────────────────────────────

function KeyStatus({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="flex items-center gap-1.5 text-xs text-emerald-400">
      <CheckCircle2 size={13} />
      Configured
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-xs text-zinc-600">
      <XCircle size={13} />
      Not set
    </span>
  );
}

// ── Provider status dot ────────────────────────────────────────────────────────

function ProviderDot({ status }: { status?: string }) {
  const color =
    status === "ok"
      ? "bg-emerald-400"
      : status === "error"
      ? "bg-red-400"
      : "bg-zinc-600";
  const label =
    status === "ok" ? "Online" : status === "error" ? "Error" : "Unconfigured";
  return (
    <span className="flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

// ── Danger button ─────────────────────────────────────────────────────────────

function DangerButton({
  label,
  description,
  onConfirm,
  loading,
}: {
  label: string;
  description: string;
  onConfirm: () => Promise<void>;
  loading: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  const handleClick = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await onConfirm();
    setConfirming(false);
  };

  return (
    <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-300">{label}</p>
        <p className="text-xs text-zinc-600 mt-0.5">{description}</p>
      </div>
      <button
        onClick={handleClick}
        disabled={loading}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 flex-shrink-0 ${
          confirming
            ? "bg-red-700 hover:bg-red-600 text-white border border-red-600"
            : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
        }`}
      >
        {loading ? (
          <RefreshCw size={12} className="animate-spin" />
        ) : confirming ? (
          <AlertTriangle size={12} />
        ) : (
          <Trash2 size={12} />
        )}
        {confirming ? "Confirm" : "Clear"}
      </button>
    </div>
  );
}

// ── Model selector row ────────────────────────────────────────────────────────

function ModelSelectRow({
  label,
  hint,
  allModels,
  value,
  provider,
  onSelect,
}: {
  label: string;
  hint?: string;
  allModels: { ollama: ModelInfo[]; openai: ModelInfo[]; anthropic: ModelInfo[] };
  value: string;
  provider: string;
  onSelect: (model: string, provider: "ollama" | "openai" | "anthropic") => void;
}) {
  const all = [
    ...allModels.ollama.map((m) => ({ ...m, provider: "ollama" as const })),
    ...allModels.openai.map((m) => ({ ...m, provider: "openai" as const })),
    ...allModels.anthropic.map((m) => ({ ...m, provider: "anthropic" as const })),
  ];

  return (
    <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-300">{label}</p>
        {hint && <p className="text-xs text-zinc-600 mt-0.5">{hint}</p>}
      </div>
      <select
        value={`${provider}:${value}`}
        onChange={(e) => {
          const [p, ...rest] = e.target.value.split(":");
          onSelect(rest.join(":"), p as "ollama" | "openai" | "anthropic");
        }}
        className="text-xs bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg px-2 py-1.5 focus:outline-none focus:border-zinc-500 flex-shrink-0"
      >
        <option value=":">Default (from model selector)</option>
        {all.map((m) => (
          <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
            {m.provider} / {m.name || m.id}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const {
    theme,
    toggleTheme,
    ollamaHost,
    selectedModel,
    selectedProvider,
    defaultResearchModel,
    defaultResearchProvider,
    setSettings,
    setModel,
  } = useStore();

  const [statuses, setStatuses] = useState<Record<string, ProviderStatus>>({});
  const [allModels, setAllModels] = useState<{
    ollama: ModelInfo[];
    openai: ModelInfo[];
    anthropic: ModelInfo[];
  }>({ ollama: [], openai: [], anthropic: [] });
  const [clearingConvs, setClearingConvs] = useState(false);
  const [clearingDocs, setClearingDocs] = useState(false);

  useEffect(() => {
    Promise.all([getProviderStatus(), getModels()])
      .then(([s, m]) => {
        setStatuses(s);
        setAllModels(m);
      })
      .catch(console.error);
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────

  const clearAllConversations = async () => {
    setClearingConvs(true);
    try {
      const convs = await getConversations();
      await Promise.allSettled(convs.map((c) => deleteConversation(c.id)));
    } finally {
      setClearingConvs(false);
    }
  };

  const clearAllDocuments = async () => {
    setClearingDocs(true);
    try {
      const docs = await getDocuments();
      await Promise.allSettled(docs.map((d) => deleteDocument(d.id)));
    } finally {
      setClearingDocs(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full px-6 py-8 space-y-10">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Settings</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Configure LocalMind preferences. Persistent changes (API keys,
            Ollama URL) require editing{" "}
            <code className="text-zinc-400 bg-zinc-800 px-1 rounded text-xs">
              backend/.env
            </code>
            .
          </p>
        </div>

        {/* ── Appearance ───────────────────────────────────────────────── */}
        <Section title="Appearance">
          <Row label="Theme" hint="Switches the UI between dark and light mode">
            <button
              onClick={toggleTheme}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                theme === "dark"
                  ? "bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                  : "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100"
              }`}
            >
              {theme === "dark" ? (
                <>
                  <Moon size={14} /> Dark
                </>
              ) : (
                <>
                  <Sun size={14} /> Light
                </>
              )}
            </button>
          </Row>
        </Section>

        {/* ── Providers ────────────────────────────────────────────────── */}
        <Section
          title="AI Providers"
          description="API keys must be set in backend/.env — they are never stored in the browser."
        >
          {/* Ollama */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <Server size={15} className="text-zinc-500" />
              <span className="text-sm font-medium text-zinc-300 flex-1">
                Ollama (local)
              </span>
              <ProviderDot status={statuses.ollama?.status} />
            </div>
            <div className="px-4 py-3 space-y-1">
              <p className="text-xs text-zinc-500">Host URL</p>
              <div className="flex gap-2">
                <input
                  value={ollamaHost || statuses.ollama?.host || "http://localhost:11434"}
                  onChange={(e) => setSettings({ ollamaHost: e.target.value })}
                  placeholder="http://localhost:11434"
                  className="flex-1 text-xs bg-zinc-800 text-zinc-300 placeholder:text-zinc-600 border border-zinc-700 rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-500 font-mono"
                />
              </div>
              <p className="text-[11px] text-zinc-700">
                Stored locally — update OLLAMA_HOST in .env for the backend
              </p>
            </div>
            {statuses.ollama?.model_count != null && (
              <div className="px-4 py-2">
                <span className="text-xs text-zinc-600">
                  {statuses.ollama.model_count} models available
                </span>
              </div>
            )}
          </div>

          {/* OpenAI */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <Zap size={15} className="text-zinc-500" />
              <span className="text-sm font-medium text-zinc-300 flex-1">
                OpenAI
              </span>
              <ProviderDot status={statuses.openai?.status} />
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-xs text-zinc-500">OPENAI_API_KEY</p>
              <KeyStatus configured={statuses.openai?.status === "ok"} />
            </div>
          </div>

          {/* Anthropic */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <Brain size={15} className="text-zinc-500" />
              <span className="text-sm font-medium text-zinc-300 flex-1">
                Anthropic
              </span>
              <ProviderDot status={statuses.anthropic?.status} />
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-xs text-zinc-500">ANTHROPIC_API_KEY</p>
              <KeyStatus configured={statuses.anthropic?.status === "ok"} />
            </div>
          </div>
        </Section>

        {/* ── Model defaults ────────────────────────────────────────────── */}
        <Section
          title="Default Models"
          description="Override which model is used per task type."
        >
          <ModelSelectRow
            label="Chat model"
            hint="Used for all conversations in the Chat tab"
            allModels={allModels}
            value={selectedModel}
            provider={selectedProvider}
            onSelect={(m, p) => setModel(m || "llama3.2", p || "ollama")}
          />
          <ModelSelectRow
            label="Research model"
            hint="Used for deep research sessions. Falls back to chat model if unset."
            allModels={allModels}
            value={defaultResearchModel}
            provider={defaultResearchProvider}
            onSelect={(m, p) =>
              setSettings({ defaultResearchModel: m, defaultResearchProvider: p })
            }
          />
        </Section>

        {/* ── Data management ───────────────────────────────────────────── */}
        <Section
          title="Data Management"
          description="These actions are permanent and cannot be undone."
        >
          <DangerButton
            label="Clear all conversations"
            description="Permanently deletes all chat history from the database"
            onConfirm={clearAllConversations}
            loading={clearingConvs}
          />
          <DangerButton
            label="Clear all documents"
            description="Permanently deletes all uploaded documents and their embeddings"
            onConfirm={clearAllDocuments}
            loading={clearingDocs}
          />
        </Section>

        {/* ── About ──────────────────────────────────────────────────────── */}
        <div className="pt-4 border-t border-zinc-800/80">
          <p className="text-xs text-zinc-700">
            LocalMind v0.1.0 · Open source ·{" "}
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-600 hover:text-zinc-400 underline"
            >
              GitHub
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
