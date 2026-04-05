"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ExternalLink, Brain, User } from "lucide-react";
import type { LocalMessage } from "@/store";

interface Props {
  message: LocalMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
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
        className={`flex flex-col gap-2 max-w-[85%] ${
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
          <div
            className={`text-zinc-100 ${
              message.isStreaming && !message.content
                ? "typing-cursor"
                : message.isStreaming
                ? ""
                : ""
            }`}
          >
            {message.content ? (
              <div className={`prose prose-sm max-w-none ${message.isStreaming ? "typing-cursor" : ""}`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    // Style inline code separately from blocks
                    code({ className, children, ...props }) {
                      // rehype-highlight adds a language-* class to block code
                      const isBlock = !!className?.startsWith("language-");
                      if (isBlock) {
                        return (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
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
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            ) : message.isStreaming ? (
              /* Empty streaming placeholder */
              <span className="typing-cursor text-zinc-500" />
            ) : null}
          </div>
        )}

        {/* ── Source citations ───────────────────────────────────────────── */}
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
      </div>
    </div>
  );
}

export default MessageBubble;
