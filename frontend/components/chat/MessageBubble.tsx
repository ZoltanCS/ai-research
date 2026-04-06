"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, Brain, User, Copy, Check } from "lucide-react";
import type { LocalMessage } from "@/store";
import { ChainOfThought, parseChainOfThought } from "./ChainOfThought";
import { CodeBlock } from "./CodeBlock";

interface Props {
  message: LocalMessage;
}

// ── Copy button for full message ──────────────────────────────────────────────

function CopyMsgButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      title="Copy message"
      className="opacity-0 group-hover/msg:opacity-100 transition-opacity p-1 text-zinc-600 hover:text-zinc-300 rounded"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  // Parse chain-of-thought for assistant messages
  const parsed = !isUser
    ? parseChainOfThought(message.content)
    : { thinkContent: null, mainContent: message.content, isThinkingComplete: true };

  const displayContent = parsed.mainContent;
  const showThinking = !isUser && parsed.thinkContent !== null;

  return (
    <div
      className={`flex gap-3 group/msg animate-in fade-in slide-in-from-bottom-2 duration-300 ${
        isUser ? "flex-row-reverse" : "flex-row"
      }`}
    >
      {/* ── Avatar ──────────────────────────────────────────────────────── */}
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
          isUser ? "bg-blue-600" : "bg-zinc-700"
        }`}
      >
        {isUser ? (
          <User size={14} className="text-white" />
        ) : (
          <Brain size={14} className="text-zinc-300" />
        )}
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div
        className={`flex flex-col gap-1.5 max-w-[85%] min-w-0 ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        {isUser ? (
          /* User bubble */
          <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : (
          /* Assistant — full-width markdown */
          <div className="w-full min-w-0">
            {/* Chain of thought */}
            {showThinking && (
              <ChainOfThought
                thinkContent={parsed.thinkContent!}
                isComplete={parsed.isThinkingComplete}
                isStreaming={message.isStreaming}
              />
            )}

            {/* Main content */}
            <div
              className={`text-zinc-100 w-full min-w-0 ${
                message.isStreaming && !displayContent ? "typing-cursor" : ""
              }`}
            >
              {displayContent ? (
                <div
                  className={`prose prose-sm prose-invert max-w-none ${
                    message.isStreaming && !showThinking ? "typing-cursor" : ""
                  }`}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // Enhanced code blocks with copy + preview
                      code({ className, children, ...props }) {
                        const isBlock = !!className?.startsWith("language-");
                        const lang = className?.replace("language-", "") ?? "";
                        const codeStr = String(children).replace(/\n$/, "");

                        if (isBlock) {
                          return <CodeBlock language={lang} code={codeStr} />;
                        }
                        return (
                          <code
                            className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[0.82em] text-zinc-200 font-mono"
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      },
                      // Open links in new tab
                      a({ href, children, ...props }) {
                        return (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 underline underline-offset-2 hover:text-blue-300 transition-colors"
                            {...props}
                          >
                            {children}
                            <ExternalLink
                              size={10}
                              className="inline ml-0.5 opacity-60"
                            />
                          </a>
                        );
                      },
                      // Tables
                      table({ children }) {
                        return (
                          <div className="overflow-x-auto my-3">
                            <table className="border-collapse w-full text-sm">
                              {children}
                            </table>
                          </div>
                        );
                      },
                      th({ children }) {
                        return (
                          <th className="border border-zinc-700 px-3 py-2 bg-zinc-800 text-left font-semibold text-zinc-200">
                            {children}
                          </th>
                        );
                      },
                      td({ children }) {
                        return (
                          <td className="border border-zinc-800 px-3 py-2 text-zinc-300">
                            {children}
                          </td>
                        );
                      },
                      // Blockquote
                      blockquote({ children }) {
                        return (
                          <blockquote className="border-l-2 border-zinc-600 pl-4 text-zinc-400 italic my-2">
                            {children}
                          </blockquote>
                        );
                      },
                    }}
                  >
                    {displayContent}
                  </ReactMarkdown>
                </div>
              ) : message.isStreaming && !showThinking ? (
                <span className="typing-cursor text-zinc-500" />
              ) : null}
            </div>
          </div>
        )}

        {/* ── Source citations ─────────────────────────────────────────── */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {message.sources.map((source, i) => (
              <a
                key={i}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded-full border border-zinc-700/60 transition-colors"
              >
                <span className="text-zinc-600 font-mono">[{i + 1}]</span>
                <span className="truncate max-w-[180px]">
                  {source.title || source.url}
                </span>
                <ExternalLink size={10} className="flex-shrink-0 text-zinc-600" />
              </a>
            ))}
          </div>
        )}

        {/* ── Copy button (assistant only) ─────────────────────────────── */}
        {!isUser && message.content && !message.isStreaming && (
          <div className="flex justify-start mt-0.5">
            <CopyMsgButton text={message.content} />
          </div>
        )}
      </div>
    </div>
  );
}

export default MessageBubble;
