"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sun, Moon, Server, Zap, Brain, Cpu, Globe,
  Eye, EyeOff, Trash2, AlertTriangle, RefreshCw,
  CheckCircle2, XCircle, Plus, X as XIcon,
} from "lucide-react";
import { toast } from "sonner";
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

// ── Shared layout primitives ──────────────────────────────────────────────────

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
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        {description && (
          <p className="text-xs text-zinc-600 mt-0.5">{description}</p>
        )}
      </div>
      <div className="space-y-2">{children}</div>
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
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm text-zinc-300">{label}</p>
        {hint && <p className="text-xs text-zinc-600 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  if (!status || status === "unconfigured")
    return <span className="text-xs text-zinc-600">Not configured</span>;
  if (status === "ok")
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-400">
        <CheckCircle2 size={11} /> Online
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs text-red-400">
      <XCircle size={11} /> Error
    </span>
  );
}

// ── API key input ─────────────────────────────────────────────────────────────

function ApiKeyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Paste API key…"}
        autoComplete="off"
        className="flex-1 text-xs bg-zinc-800 text-zinc-300 placeholder:text-zinc-600 border border-zinc-700 rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-500 font-mono"
      />
      <button
        onClick={() => setShow((s) => !s)}
        className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

// ── Model list manager ────────────────────────────────────────────────────────

function ModelManager({
  provider,
  fetchedModels,
  customModels,
  onAdd,
  onRemove,
  onSelect,
  selectedModel,
  selectedProvider,
}: {
  provider: string;
  fetchedModels: ModelInfo[];
  customModels: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string, provider: string) => void;
  selectedModel: string;
  selectedProvider: string;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const allIds = new Set(fetchedModels.map((m) => m.id));
  const extraCustom = customModels.filter((id) => !allIds.has(id));

  const handleAdd = () => {
    const id = input.trim();
    if (!id) return;
    onAdd(id);
    setInput("");
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-1">
      {/* Fetched models */}
      {fetchedModels.map((m) => {
        const active = m.id === selectedModel && provider === selectedProvider;
        return (
          <div
            key={m.id}
            onClick={() => onSelect(m.id, provider)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors group ${
              active
                ? "bg-blue-600/20 border border-blue-500/30"
                : "hover:bg-zinc-800 border border-transparent"
            }`}
          >
            <span className={`flex-1 text-xs truncate font-mono ${active ? "text-blue-300" : "text-zinc-400"}`}>
              {m.name || m.id}
            </span>
            {m.context_length && (
              <span className="text-[10px] text-zinc-600 flex-shrink-0">
                {(m.context_length / 1000).toFixed(0)}k
              </span>
            )}
            {active && <span className="text-[10px] text-blue-400 flex-shrink-0">active</span>}
          </div>
        );
      })}

      {/* Custom models */}
      {extraCustom.map((id) => {
        const active = id === selectedModel && provider === selectedProvider;
        return (
          <div
            key={id}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border group transition-colors ${
              active
                ? "bg-blue-600/20 border-blue-500/30"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
          >
            <span
              onClick={() => onSelect(id, provider)}
              className={`flex-1 text-xs truncate font-mono cursor-pointer ${active ? "text-blue-300" : "text-zinc-400"}`}
            >
              {id}
            </span>
            <span className="text-[10px] text-zinc-600 flex-shrink-0">custom</span>
            <button
              onClick={() => onRemove(id)}
              className="text-zinc-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
            >
              <XIcon size={11} />
            </button>
          </div>
        );
      })}

      {/* Add custom model */}
      <div className="flex gap-1 mt-1">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Add model ID (e.g. gpt-4-turbo)"
          className="flex-1 text-xs bg-zinc-900 text-zinc-400 placeholder:text-zinc-700 border border-zinc-800 rounded-lg px-3 py-1.5 focus:outline-none focus:border-zinc-600 font-mono"
        />
        <button
          onClick={handleAdd}
          disabled={!input.trim()}
          className="px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 rounded-lg transition-colors"
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
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
  onConfirm: () => void;
  loading: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p className="text-sm text-zinc-300">{label}</p>
        <p className="text-xs text-zinc-600">{description}</p>
      </div>
      {confirming ? (
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => { setConfirming(false); onConfirm(); }}
            disabled={loading}
            className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? "…" : "Confirm"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-900 hover:bg-zinc-800 text-red-400 border border-zinc-800 rounded-lg transition-colors flex-shrink-0"
        >
          <Trash2 size={11} /> {label}
        </button>
      )}
    </div>
  );
}

// ── Provider card ─────────────────────────────────────────────────────────────

const PROVIDER_CONFIG = [
  {
    key: "ollama" as const,
    label: "Ollama",
    Icon: Server,
    isLocal: true,
  },
  {
    key: "openai" as const,
    label: "OpenAI",
    Icon: Zap,
    keyField: "openai" as const,
    placeholder: "sk-…",
  },
  {
    key: "anthropic" as const,
    label: "Anthropic",
    Icon: Brain,
    keyField: "anthropic" as const,
    placeholder: "sk-ant-…",
  },
  {
    key: "cerebras" as const,
    label: "Cerebras",
    Icon: Cpu,
    keyField: "cerebras" as const,
    placeholder: "API key from cloud.cerebras.ai",
  },
  {
    key: "vercel" as const,
    label: "Vercel Gateway",
    Icon: Globe,
    keyField: "vercel" as const,
    placeholder: "Vercel API token",
    hasGatewayUrl: true,
  },
] as const;

// ── Main component ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const {
    theme,
    toggleTheme,
    ollamaHost,
    providerKeys,
    customModels,
    selectedModel,
    selectedProvider,
    defaultResearchModel,
    defaultResearchProvider,
    setSettings,
    setModel,
    setProviderKey,
    addCustomModel,
    removeCustomModel,
  } = useStore();

  const [statuses, setStatuses] = useState<Record<string, ProviderStatus>>({});
  const [allModels, setAllModels] = useState<Record<string, ModelInfo[]>>({});
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [clearingConvs, setClearingConvs] = useState(false);
  const [clearingDocs, setClearingDocs] = useState(false);

  const fetchStatus = async () => {
    setLoadingStatus(true);
    try {
      const [s, m] = await Promise.all([getProviderStatus(), getModels()]);
      setStatuses(s);
      setAllModels(m as unknown as Record<string, ModelInfo[]>);
    } catch (e) {
      toast.error("Failed to reach backend");
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const clearAllConversations = async () => {
    setClearingConvs(true);
    try {
      const convs = await getConversations();
      await Promise.allSettled(convs.map((c) => deleteConversation(c.id)));
      toast.success("All conversations deleted");
    } catch {
      toast.error("Failed to clear conversations");
    } finally {
      setClearingConvs(false);
    }
  };

  const clearAllDocuments = async () => {
    setClearingDocs(true);
    try {
      const docs = await getDocuments();
      await Promise.allSettled(docs.map((d) => deleteDocument(d.id)));
      toast.success("All documents deleted");
    } catch {
      toast.error("Failed to clear documents");
    } finally {
      setClearingDocs(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full px-6 py-8 space-y-10">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Settings</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Configure providers and models. All keys are stored in your browser only.
            </p>
          </div>
          <button
            onClick={fetchStatus}
            disabled={loadingStatus}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw size={11} className={loadingStatus ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* ── Appearance ───────────────────────────────────────────────────── */}
        <Section title="Appearance">
          <Row label="Theme" hint="Switch between dark and light mode">
            <button
              onClick={toggleTheme}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                theme === "dark"
                  ? "bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                  : "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100"
              }`}
            >
              {theme === "dark" ? <><Moon size={14} /> Dark</> : <><Sun size={14} /> Light</>}
            </button>
          </Row>
        </Section>

        {/* ── Providers ────────────────────────────────────────────────────── */}
        <Section
          title="Providers & Models"
          description="Enter API keys to unlock providers. Keys are sent only to your local backend."
        >
          {PROVIDER_CONFIG.map((cfg) => {
            const { key, label, Icon } = cfg;
            const isLocal = "isLocal" in cfg ? cfg.isLocal : false;
            const keyField = "keyField" in cfg ? cfg.keyField : undefined;
            const placeholder = "placeholder" in cfg ? cfg.placeholder : undefined;
            const hasGatewayUrl = "hasGatewayUrl" in cfg ? cfg.hasGatewayUrl : false;
            const status = statuses[key];
            const fetchedModels = (allModels[key] ?? []) as ModelInfo[];
            const custom = customModels[key] ?? [];

            return (
              <div
                key={key}
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden"
              >
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60">
                  <Icon size={14} className="text-zinc-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-zinc-200 flex-1">{label}</span>
                  <StatusBadge status={status?.status} />
                </div>

                <div className="px-4 py-3 space-y-3">
                  {/* Ollama host */}
                  {isLocal && (
                    <div className="space-y-1">
                      <p className="text-xs text-zinc-500">Host URL</p>
                      <input
                        value={ollamaHost || ""}
                        onChange={(e) => setSettings({ ollamaHost: e.target.value })}
                        onBlur={fetchStatus}
                        placeholder="http://localhost:11434"
                        className="w-full text-xs bg-zinc-800 text-zinc-300 placeholder:text-zinc-600 border border-zinc-700 rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-500 font-mono"
                      />
                      {status?.model_count != null && (
                        <p className="text-[11px] text-zinc-600">
                          {status.model_count} models installed
                        </p>
                      )}
                    </div>
                  )}

                  {/* Cloud API key */}
                  {keyField && (
                    <div className="space-y-1">
                      <p className="text-xs text-zinc-500">API Key</p>
                      <ApiKeyInput
                        value={providerKeys[keyField] ?? ""}
                        onChange={(v) => setProviderKey(keyField, v)}
                        placeholder={placeholder}
                      />
                    </div>
                  )}

                  {/* Vercel gateway URL */}
                  {hasGatewayUrl && (
                    <div className="space-y-1">
                      <p className="text-xs text-zinc-500">Gateway URL</p>
                      <input
                        value={providerKeys.vercelGateway || ""}
                        onChange={(e) => setProviderKey("vercelGateway", e.target.value)}
                        placeholder="https://ai-gateway.vercel.sh/v1"
                        className="w-full text-xs bg-zinc-800 text-zinc-300 placeholder:text-zinc-600 border border-zinc-700 rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-500 font-mono"
                      />
                    </div>
                  )}

                  {/* Models */}
                  <div className="space-y-1">
                    <p className="text-xs text-zinc-500">Models</p>
                    <ModelManager
                      provider={key}
                      fetchedModels={fetchedModels}
                      customModels={custom}
                      onAdd={(id) => addCustomModel(key, id)}
                      onRemove={(id) => removeCustomModel(key, id)}
                      onSelect={(id, p) => setModel(id, p)}
                      selectedModel={selectedModel}
                      selectedProvider={selectedProvider}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </Section>

        {/* ── Data Management ───────────────────────────────────────────────── */}
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

        {/* ── About ─────────────────────────────────────────────────────────── */}
        <div className="pt-4 border-t border-zinc-800/80">
          <p className="text-xs text-zinc-700">
            LocalMind v0.1.0 · Open source ·{" "}
            <a
              href="https://github.com/zoltancs/ai-research"
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
