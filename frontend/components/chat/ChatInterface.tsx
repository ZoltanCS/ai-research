"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Brain, Globe, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useStore, type LocalMessage } from "@/store";
import { streamChatMessage, getConversation } from "@/lib/api";
import { MessageBubble } from "./MessageBubble";
import InputArea from "./InputArea";
import SystemPromptEditor from "./SystemPromptEditor";

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-4">
      <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center ring-1 ring-zinc-700">
        <Brain size={26} className="text-zinc-400" />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-zinc-100 tracking-tight">
          LocalMind
        </h2>
        <p className="text-sm text-zinc-500 max-w-xs">
          Chat with local or cloud AI models. Attach documents, enable web
          search, or start a deep research session.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {["Local models via Ollama", "RAG over your documents", "Web search", "Deep research"].map(
          (label) => (
            <span
              key={label}
              className="px-3 py-1 text-xs text-zinc-500 bg-zinc-900 rounded-full border border-zinc-800"
            >
              {label}
            </span>
          )
        )}
      </div>
    </div>
  );
}

// ── ChatInterface ─────────────────────────────────────────────────────────────

export function ChatInterface() {
  const {
    messages,
    conversationId,
    isStreaming,
    selectedModel,
    selectedProvider,
    useRag,
    useWebSearch,
    systemPrompt,
    addMessage,
    appendToLastMessage,
    finalizeLastMessage,
    setConversationId,
    setIsStreaming,
    clearChat,
  } = useStore();

  const [activeSearch, setActiveSearch] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const searchParams = useSearchParams();

  // ── Load conversation from URL param ──────────────────────────────────────

  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    if (id === conversationId) return;

    clearChat();
    getConversation(id)
      .then((conv) => {
        conv.messages.forEach((m) =>
          addMessage({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
          })
        );
        setConversationId(id);
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ── Auto-scroll to bottom ─────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Submit handler ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (input: string) => {
      if (!input.trim() || isStreaming) return;

      const userMessage: LocalMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: input.trim(),
      };

      // Snapshot existing messages BEFORE mutating store
      const existingMessages = useStore.getState().messages;
      const apiMessages = [
        ...existingMessages
          .filter((m) => m.content.trim() !== "")
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: userMessage.content },
      ];

      // Update store
      addMessage(userMessage);
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        isStreaming: true,
      });
      setIsStreaming(true);

      // Abort any previous in-flight request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        await streamChatMessage({
          messages: apiMessages,
          model: selectedModel,
          provider: selectedProvider,
          systemPrompt: systemPrompt || undefined,
          conversationId,
          useRag,
          useWebSearch,
          onToken: appendToLastMessage,
          onDone: (newId) => {
            setActiveSearch(null);
            finalizeLastMessage();
            if (newId) setConversationId(newId);
          },
          onError: (err) => {
            setActiveSearch(null);
            appendToLastMessage(`\n\n⚠️ Error: ${err}`);
            finalizeLastMessage();
            toast.error(err);
          },
          onToolCall: (tool) => {
            if (tool.type === "web_search") setActiveSearch(tool.query);
          },
          onToolResult: () => {
            setActiveSearch(null);
          },
          signal: abortRef.current.signal,
        });
      } catch (e: unknown) {
        const name = e instanceof Error ? e.name : "";
        if (name !== "AbortError") {
          const msg = e instanceof Error ? e.message : "Unknown error";
          appendToLastMessage(`\n\n⚠️ Error: ${msg}`);
          finalizeLastMessage();
          toast.error(msg);
        }
      }
    },
    [
      isStreaming,
      selectedModel,
      selectedProvider,
      conversationId,
      useRag,
      useWebSearch,
      systemPrompt,
      addMessage,
      appendToLastMessage,
      finalizeLastMessage,
      setConversationId,
      setIsStreaming,
    ]
  );

  // ── Stop handler ──────────────────────────────────────────────────────────

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setActiveSearch(null);
    finalizeLastMessage();
  }, [finalizeLastMessage]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* System prompt editor (collapsible) */}
      <SystemPromptEditor />

      {/* Message list */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Active web search indicator */}
      {activeSearch && (
        <div className="flex items-center gap-2 text-xs text-zinc-500 px-4 py-1">
          <Globe size={12} className="animate-spin" />
          Searching: {activeSearch}
        </div>
      )}

      {/* Input area */}
      <InputArea onSubmit={handleSubmit} onStop={handleStop} />
    </div>
  );
}

export default ChatInterface;
