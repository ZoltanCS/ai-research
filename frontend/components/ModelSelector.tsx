"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Server, Zap, Brain, Cpu, Globe, Check } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useStore } from "@/store";
import { getModels, getProviderStatus, type AllModels, type ModelInfo, type ProviderStatus } from "@/lib/api";

// ── Provider metadata ─────────────────────────────────────────────────────────

const PROVIDERS = ["ollama", "openai", "anthropic", "cerebras", "vercel"] as const;
type ProviderKey = (typeof PROVIDERS)[number];

const PROVIDER_META: Record<
  ProviderKey,
  { label: string; Icon: React.ElementType }
> = {
  ollama:    { label: "Ollama",           Icon: Server },
  openai:    { label: "OpenAI",           Icon: Zap    },
  anthropic: { label: "Anthropic",        Icon: Brain  },
  cerebras:  { label: "Cerebras",         Icon: Cpu    },
  vercel:    { label: "Vercel Gateway",   Icon: Globe  },
};

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status?: string }) {
  const color =
    status === "ok"
      ? "bg-emerald-400"
      : status === "error"
      ? "bg-red-400"
      : "bg-zinc-600";
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ModelSelector() {
  const { selectedModel, selectedProvider, setModel, customModels } = useStore();

  const [models, setModels] = useState<AllModels>({
    ollama: [],
    openai: [],
    anthropic: [],
    cerebras: [],
    vercel: [],
  });
  const [statuses, setStatuses] = useState<Record<string, ProviderStatus>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getModels(), getProviderStatus()])
      .then(([m, s]) => {
        setModels(m);
        setStatuses(s);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const { Icon: CurrentIcon } =
    PROVIDER_META[selectedProvider as ProviderKey] ?? PROVIDER_META.ollama;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors group">
          <CurrentIcon size={14} className="text-zinc-400 group-hover:text-zinc-300" />
          <span className="max-w-[200px] truncate font-medium">{selectedModel}</span>
          <ChevronDown size={12} className="text-zinc-500 flex-shrink-0" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-72 rounded-xl border border-zinc-700/60 bg-zinc-900 py-1.5 shadow-2xl shadow-black/40 backdrop-blur-sm"
        >
          {PROVIDERS.map((provider, i) => {
            const { label, Icon } = PROVIDER_META[provider];
            const status = statuses[provider];
            const fetched = models[provider] ?? [];
            const fetchedIds = new Set(fetched.map((m) => m.id));
            const extra = (customModels[provider] ?? [])
              .filter((id) => !fetchedIds.has(id))
              .map((id): ModelInfo => ({ id, name: id, provider, context_length: undefined }));
            const providerModels = [...fetched, ...extra];
            const isLast = i === PROVIDERS.length - 1;

            return (
              <div key={provider}>
                {/* Provider group header */}
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <Icon size={12} className="text-zinc-500" />
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    {label}
                  </span>
                  <span className="ml-auto">
                    <StatusDot status={status?.status} />
                  </span>
                </div>

                {/* Model list */}
                {loading ? (
                  <p className="px-3 py-1 pl-7 text-xs text-zinc-600">Loading…</p>
                ) : providerModels.length === 0 ? (
                  <p className="px-3 py-1 pl-7 text-xs text-zinc-600">
                    {status?.status === "unconfigured"
                      ? "Not configured"
                      : "No models available"}
                  </p>
                ) : (
                  providerModels.map((model) => {
                    const active =
                      model.id === selectedModel && provider === selectedProvider;
                    return (
                      <DropdownMenu.Item
                        key={model.id}
                        onSelect={() => setModel(model.id, provider)}
                        className={`flex items-center gap-2 px-3 py-1.5 pl-7 text-sm cursor-pointer select-none outline-none transition-colors rounded-sm mx-1 ${
                          active
                            ? "bg-zinc-700/70 text-white"
                            : "text-zinc-300 hover:bg-zinc-800 hover:text-white data-[highlighted]:bg-zinc-800 data-[highlighted]:text-white"
                        }`}
                      >
                        <span className="flex-1 truncate">{model.name || model.id}</span>
                        {model.context_length && (
                          <span className="text-xs text-zinc-600 flex-shrink-0">
                            {(model.context_length / 1000).toFixed(0)}k
                          </span>
                        )}
                        {active && (
                          <Check size={12} className="text-blue-400 flex-shrink-0" />
                        )}
                      </DropdownMenu.Item>
                    );
                  })
                )}

                {!isLast && (
                  <DropdownMenu.Separator className="my-1.5 border-t border-zinc-800/80" />
                )}
              </div>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
