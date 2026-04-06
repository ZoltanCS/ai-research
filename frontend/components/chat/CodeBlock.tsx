"use client";

import { useState, useCallback } from "react";
import { Copy, Check, Play, Eye, EyeOff } from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────────

const PREVIEW_LANGS = new Set(["html", "css", "javascript", "js", "svg"]);
const RUN_LANGS = new Set(["python", "javascript", "js", "bash", "sh"]);

function buildPreviewSrc(language: string, code: string): string {
  switch (language) {
    case "html":
    case "svg":
      return code;
    case "css":
      return `<!DOCTYPE html><html><head><style>${code}</style></head><body><p style="color:inherit;padding:1rem">CSS preview — add HTML elements to see them styled.</p></body></html>`;
    case "javascript":
    case "js":
      return `<!DOCTYPE html><html><head></head><body><pre id="out" style="font-family:monospace;padding:1rem;color:#e4e4e7;background:#09090b;min-height:100vh;margin:0;white-space:pre-wrap"></pre><script>
const _log=console.log;console.log=(...a)=>{document.getElementById('out').textContent+=a.join(' ')+'\\n';_log(...a)};
try{${code}}catch(e){document.getElementById('out').textContent='Error: '+e.message;}
<\/script></body></html>`;
    default:
      return code;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  language: string;
  code: string;
  onRun?: (code: string, language: string) => void;
}

export function CodeBlock({ language, code, onRun }: Props) {
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const canPreview = PREVIEW_LANGS.has(language);
  const canRun = RUN_LANGS.has(language) && !!onRun;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className="my-3 rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden group/codeblock">
      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
        <span className="text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-widest">
          {language || "code"}
        </span>
        <div className="flex items-center gap-1">
          {canRun && (
            <button
              onClick={() => onRun(code, language)}
              title="Run code"
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 rounded transition-colors"
            >
              <Play size={10} fill="currentColor" />
              <span>Run</span>
            </button>
          )}
          {canPreview && (
            <button
              onClick={() => setPreviewOpen((v) => !v)}
              title={previewOpen ? "Hide preview" : "Show preview"}
              className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors ${
                previewOpen
                  ? "text-blue-400 bg-blue-950/40"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {previewOpen ? <EyeOff size={10} /> : <Eye size={10} />}
              <span>{previewOpen ? "Hide" : "Preview"}</span>
            </button>
          )}
          <button
            onClick={handleCopy}
            title="Copy code"
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
          >
            {copied ? (
              <Check size={10} className="text-emerald-400" />
            ) : (
              <Copy size={10} />
            )}
            <span>{copied ? "Copied!" : "Copy"}</span>
          </button>
        </div>
      </div>

      {/* ── Code ────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <pre className="p-4 text-[13px] leading-relaxed text-zinc-300 font-mono">
          <code>{code}</code>
        </pre>
      </div>

      {/* ── Preview iframe ───────────────────────────────────────────────── */}
      {canPreview && previewOpen && (
        <div className="border-t border-zinc-800">
          <div className="px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
            <span className="text-[10px] text-zinc-600 font-mono uppercase tracking-widest">Preview</span>
          </div>
          <iframe
            srcDoc={buildPreviewSrc(language, code)}
            sandbox="allow-scripts"
            className="w-full bg-white"
            style={{ height: "300px", border: "none" }}
            title="Code preview"
          />
        </div>
      )}
    </div>
  );
}

export default CodeBlock;
