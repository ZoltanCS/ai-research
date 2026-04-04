"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Send, Globe, BookOpen, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  sendMessage,
  getConversation,
  uploadDocument,
  type Message,
  type Document,
} from "@/lib/api";
import { MessageBubble } from "./MessageBubble";

type ChatMessage = Message | { role: "user" | "assistant"; content: string; streaming?: boolean };

export function ChatInterface() {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("id");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [useRag, setUseRag] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [activeConvId, setActiveConvId] = useState<string | undefined>(
    conversationId ?? undefined
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing conversation
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setActiveConvId(undefined);
      return;
    }
    setActiveConvId(conversationId);
    getConversation(conversationId)
      .then((conv) => setMessages(conv.messages))
      .catch(() => {});
  }, [conversationId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    setIsLoading(true);

    const userMsg: ChatMessage = { role: "user", content: text };
    const assistantMsg: ChatMessage = { role: "assistant", content: "", streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    await sendMessage({
      message: text,
      conversationId: activeConvId,
      useRag,
      useWebSearch,
      onToken: (token) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: last.content + token,
            };
          }
          return updated;
        });
      },
      onDone: (convId) => {
        setActiveConvId(convId);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && "streaming" in last) {
            updated[updated.length - 1] = { ...last, streaming: false };
          }
          return updated;
        });
        setIsLoading(false);
      },
      onError: (err) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: `Error: ${err}`,
          };
          return updated;
        });
        setIsLoading(false);
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const doc = await uploadDocument(file);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Document "${doc.filename}" uploaded (${doc.chunk_count} chunks). Toggle "RAG" to query it.`,
        },
      ]);
      setUseRag(true);
    } catch (err) {
      alert(`Upload failed: ${err}`);
    }
    e.target.value = "";
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <span className="text-3xl">🧠</span>
            </div>
            <h2 className="text-2xl font-semibold mb-2">LocalMind</h2>
            <p className="text-muted-foreground max-w-sm">
              Chat with local or cloud AI models. Upload documents for RAG, or
              enable web search for real-time research.
            </p>
          </div>
        ) : (
          <div className="py-4">
            {messages.map((msg, i) => (
              <MessageBubble key={i} message={msg} />
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t bg-background p-4">
        {/* Toggles */}
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => setUseRag((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              useRag
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <BookOpen className="h-3 w-3" />
            RAG
          </button>
          <button
            type="button"
            onClick={() => setUseWebSearch((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              useWebSearch
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Globe className="h-3 w-3" />
            Web Search
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={handleFileUpload}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-lg border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Upload document"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything… (Shift+Enter for new line)"
            rows={1}
            className={cn(
              "flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring",
              "min-h-[40px] max-h-[200px] overflow-y-auto"
            )}
            style={{ height: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
            }}
            disabled={isLoading}
          />

          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className={cn(
              "p-2 rounded-lg transition-colors",
              input.trim() && !isLoading
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
