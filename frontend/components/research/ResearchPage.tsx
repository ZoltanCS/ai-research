"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  Search,
  BookOpen,
  Globe,
  FileText,
  Sparkles,
  Copy,
  Download,
  Printer,
  Check,
  ChevronRight,
  Clock,
  X,
  List,
} from "lucide-react";
import {
  startResearch,
  getResearchReports,
  type ResearchEvent,
  type ResearchReport,
} from "@/lib/api";
import { useStore } from "@/store";
import { formatDate } from "@/lib/utils";

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  { key: "decompose",  label: "Decomposing",  Icon: Sparkles  },
  { key: "search",     label: "Searching",    Icon: Globe     },
  { key: "scrape",     label: "Reading",      Icon: BookOpen  },
  { key: "synthesise", label: "Synthesizing", Icon: FileText  },
] as const;

type StepKey = (typeof STEPS)[number]["key"];
type Phase = "idle" | "running" | "complete" | "error";

// ── TOC generation ────────────────────────────────────────────────────────────

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

function buildTOC(markdown: string): TocEntry[] {
  return markdown
    .split("\n")
    .map((line) => line.match(/^(#{1,3})\s+(.+)$/))
    .filter(Boolean)
    .map((m) => ({
      level: m![1].length,
      text: m![2].replace(/\*\*/g, "").trim(),
      id: m![2]
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-"),
    }));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Stepper({
  currentStep,
  phase,
}: {
  currentStep: StepKey | null;
  phase: Phase;
}) {
  const currentIdx = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, i) => {
        const isDone =
          phase === "complete" ||
          (currentIdx > i) ||
          (phase === "error" && currentIdx > i);
        const isActive = currentIdx === i && phase === "running";
        const { Icon } = step;

        return (
          <div key={step.key} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                  isDone
                    ? "bg-emerald-600 border-emerald-600 text-white"
                    : isActive
                    ? "bg-blue-600 border-blue-600 text-white animate-pulse"
                    : "bg-zinc-900 border-zinc-700 text-zinc-600"
                }`}
              >
                <Icon size={15} />
              </div>
              <span
                className={`text-[11px] font-medium whitespace-nowrap ${
                  isDone
                    ? "text-emerald-400"
                    : isActive
                    ? "text-blue-400"
                    : "text-zinc-600"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-16 h-0.5 mx-1 mb-5 transition-all duration-500 ${
                  isDone ? "bg-emerald-600" : "bg-zinc-800"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function LogEntry({ step, message, time }: { step: string; message: string; time: Date }) {
  const stepMeta = STEPS.find((s) => s.key === step);
  return (
    <div className="flex items-start gap-2 py-1.5 text-xs">
      <span className="text-zinc-600 flex-shrink-0 font-mono tabular-nums mt-px">
        {time.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
      <span
        className={`flex-shrink-0 px-1.5 py-px rounded text-[10px] font-semibold uppercase tracking-wide ${
          step === "decompose"
            ? "bg-purple-950 text-purple-400"
            : step === "search"
            ? "bg-blue-950 text-blue-400"
            : step === "scrape"
            ? "bg-amber-950 text-amber-400"
            : step === "synthesise"
            ? "bg-emerald-950 text-emerald-400"
            : "bg-zinc-800 text-zinc-400"
        }`}
      >
        {stepMeta?.label ?? step}
      </span>
      <span className="text-zinc-400 leading-relaxed">{message}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ResearchPage() {
  const { selectedModel, selectedProvider, defaultResearchModel, defaultResearchProvider } =
    useStore();

  const effectiveModel = defaultResearchModel || selectedModel;
  const effectiveProvider = defaultResearchModel
    ? defaultResearchProvider
    : selectedProvider;

  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [currentStep, setCurrentStep] = useState<StepKey | null>(null);
  const [logs, setLogs] = useState<Array<{ step: string; message: string; time: Date }>>([]);
  const [streamingReport, setStreamingReport] = useState("");
  const [finalReport, setFinalReport] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedReports, setSavedReports] = useState<ResearchReport[]>([]);
  const [viewingReport, setViewingReport] = useState<ResearchReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [showToc, setShowToc] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const displayReport = viewingReport?.report ?? finalReport ?? streamingReport;
  const displayQuery = viewingReport?.query ?? query;

  // ── Load saved reports ──────────────────────────────────────────────────

  useEffect(() => {
    getResearchReports().then(setSavedReports).catch(console.error);
  }, []);

  // ── Auto-scroll log ─────────────────────────────────────────────────────

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── Start research ──────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    if (!query.trim() || phase === "running") return;

    setPhase("running");
    setCurrentStep(null);
    setLogs([]);
    setStreamingReport("");
    setFinalReport(null);
    setReportId(null);
    setError(null);
    setViewingReport(null);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const handleEvent = (event: ResearchEvent) => {
      if (event.type === "progress") {
        setCurrentStep(event.step as StepKey);
        setLogs((prev) => [
          ...prev,
          { step: event.step, message: event.message, time: new Date() },
        ]);
      } else if (event.type === "token") {
        setStreamingReport((prev) => prev + event.delta);
      } else if (event.type === "complete") {
        setFinalReport(event.report);
        setReportId(event.report_id);
        setPhase("complete");
        // Refresh saved reports
        getResearchReports().then(setSavedReports).catch(console.error);
      } else if (event.type === "error") {
        setError(event.message);
        setPhase("error");
        toast.error(`Research failed: ${event.message}`);
      }
    };

    try {
      await startResearch({
        query: query.trim(),
        model: effectiveModel,
        provider: effectiveProvider,
        onEvent: handleEvent,
        signal: abortRef.current.signal,
      });
    } catch (e: unknown) {
      const name = e instanceof Error ? e.name : "";
      if (name !== "AbortError") {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        setPhase("error");
        toast.error(msg);
      }
    }
  }, [query, phase, effectiveModel, effectiveProvider]);

  const handleStop = () => {
    abortRef.current?.abort();
    if (streamingReport) {
      setFinalReport(streamingReport);
      setPhase("complete");
    } else {
      setPhase("idle");
    }
  };

  // ── Export actions ──────────────────────────────────────────────────────

  const handleCopy = async () => {
    await navigator.clipboard.writeText(displayReport);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMd = () => {
    const blob = new Blob([displayReport], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${displayQuery.slice(0, 60).replace(/[^a-z0-9]/gi, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    const html = reportRef.current?.innerHTML ?? "";
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <title>${displayQuery}</title>
      <style>
        body{font-family:system-ui,sans-serif;line-height:1.7;max-width:800px;margin:0 auto;padding:2rem;color:#111}
        h1,h2,h3{line-height:1.3;margin-top:1.5em}
        code{background:#f4f4f4;padding:.1em .35em;border-radius:3px;font-size:.85em}
        pre{background:#f4f4f4;padding:1rem;border-radius:4px;overflow-x:auto}
        pre code{background:none;padding:0}
        table{border-collapse:collapse;width:100%}
        th,td{border:1px solid #ddd;padding:.5rem .75rem;text-align:left}
        th{background:#f9f9f9}
        a{color:#2563eb}
        @media print{body{padding:0}}
      </style>
    </head><body>${html}</body></html>`);
    w.document.close();
    w.print();
  };

  // ── TOC ─────────────────────────────────────────────────────────────────

  const toc = displayReport ? buildTOC(displayReport) : [];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full bg-[#0a0a0a]">
      {/* ── Left panel: input + saved reports ─────────────────────────── */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-zinc-800/80 bg-[#0f0f0f]">
        {/* Search input */}
        <div className="p-4 border-b border-zinc-800/80 space-y-3">
          <h2 className="text-sm font-semibold text-zinc-200">Deep Research</h2>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleStart();
            }}
            placeholder="What do you want to research?"
            rows={3}
            disabled={phase === "running"}
            className="w-full resize-none text-sm bg-zinc-900 text-zinc-200 placeholder:text-zinc-600 rounded-xl border border-zinc-800 px-3 py-2.5 focus:outline-none focus:border-zinc-600 transition-colors disabled:opacity-50"
          />
          <div className="flex gap-2">
            {phase === "running" ? (
              <button
                onClick={handleStop}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-900/60 hover:bg-red-900 border border-red-800 text-red-300 text-sm font-medium rounded-xl transition-colors"
              >
                <X size={14} />
                Stop
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={!query.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-medium rounded-xl transition-colors"
              >
                <Search size={14} />
                Start Research
              </button>
            )}
          </div>
          <p className="text-[11px] text-zinc-700 text-center">
            Ctrl+Enter to start
          </p>
        </div>

        {/* Saved reports */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <p className="px-2 pb-1 text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
            Saved Reports
          </p>
          {savedReports.length === 0 ? (
            <p className="px-2 py-4 text-xs text-zinc-700 text-center">
              No reports yet
            </p>
          ) : (
            savedReports.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setViewingReport(r);
                  setPhase("complete");
                }}
                className={`w-full text-left px-3 py-2 rounded-xl transition-colors group ${
                  viewingReport?.id === r.id
                    ? "bg-zinc-800 text-zinc-200"
                    : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                }`}
              >
                <p className="text-xs truncate leading-snug">{r.query}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <Clock size={10} className="text-zinc-600" />
                  <span className="text-[11px] text-zinc-600">
                    {formatDate(r.created_at)}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: progress / report ────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {phase === "idle" ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
            <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center">
              <Search size={24} className="text-zinc-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-zinc-300">
                Start a deep research session
              </h3>
              <p className="text-sm text-zinc-600 mt-1 max-w-sm">
                Enter a research question on the left. LocalMind will
                decompose it into sub-questions, search the web, read sources,
                and synthesise a comprehensive report.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Report header / toolbar */}
            {(phase === "complete" || streamingReport) && (
              <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 border-b border-zinc-800/80">
                <p className="flex-1 text-sm font-medium text-zinc-300 truncate">
                  {displayQuery}
                </p>
                <div className="flex items-center gap-1">
                  {toc.length > 0 && (
                    <button
                      onClick={() => setShowToc((v) => !v)}
                      title="Toggle table of contents"
                      className={`p-1.5 rounded-lg transition-colors ${
                        showToc
                          ? "bg-zinc-700 text-zinc-200"
                          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                      }`}
                    >
                      <List size={14} />
                    </button>
                  )}
                  <button
                    onClick={handleCopy}
                    title="Copy markdown"
                    className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
                  >
                    {copied ? (
                      <Check size={14} className="text-emerald-400" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                  <button
                    onClick={handleDownloadMd}
                    title="Download .md"
                    className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    onClick={handlePrint}
                    title="Print / Save as PDF"
                    className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
                  >
                    <Printer size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Running state: stepper + log */}
            {phase === "running" && !streamingReport && (
              <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col gap-8">
                {/* Stepper */}
                <div className="flex justify-center">
                  <Stepper currentStep={currentStep} phase={phase} />
                </div>

                {/* Log */}
                {logs.length > 0 && (
                  <div className="max-w-2xl mx-auto w-full">
                    <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider mb-2">
                      Activity log
                    </p>
                    <div className="divide-y divide-zinc-900">
                      {logs.map((log, i) => (
                        <LogEntry key={i} {...log} />
                      ))}
                    </div>
                    <div ref={logEndRef} />
                  </div>
                )}
              </div>
            )}

            {/* Report (streaming or final) */}
            {(phase === "complete" || streamingReport) && (
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-4xl mx-auto px-6 py-6 flex gap-8">
                  {/* TOC sidebar */}
                  {showToc && toc.length > 0 && (
                    <aside className="hidden lg:block w-52 flex-shrink-0">
                      <div className="sticky top-6">
                        <p className="text-[11px] font-semibold text-zinc-600 uppercase tracking-wider mb-2">
                          Contents
                        </p>
                        <nav className="space-y-0.5">
                          {toc.map((entry, i) => (
                            <a
                              key={i}
                              href={`#${entry.id}`}
                              className={`flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-0.5 ${
                                entry.level === 2 ? "pl-3" : entry.level === 3 ? "pl-6" : ""
                              }`}
                            >
                              <ChevronRight
                                size={10}
                                className="flex-shrink-0 text-zinc-700"
                              />
                              {entry.text}
                            </a>
                          ))}
                        </nav>
                      </div>
                    </aside>
                  )}

                  {/* Markdown report */}
                  <article className="flex-1 min-w-0">
                    {/* Completion stepper recap */}
                    {phase === "complete" && !viewingReport && (
                      <div className="mb-6">
                        <Stepper currentStep={null} phase="complete" />
                      </div>
                    )}

                    <div
                      ref={reportRef}
                      className={`prose prose-sm max-w-none ${
                        !finalReport && streamingReport ? "typing-cursor" : ""
                      }`}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={{
                          h1: ({ children }) => (
                            <h1 className="text-xl font-bold text-zinc-100 mb-4 mt-0 pb-2 border-b border-zinc-800">
                              {children}
                            </h1>
                          ),
                          h2: ({ children, ...props }) => {
                            const id = String(children)
                              .toLowerCase()
                              .replace(/[^\w\s-]/g, "")
                              .trim()
                              .replace(/\s+/g, "-");
                            return (
                              <h2
                                id={id}
                                className="text-base font-semibold text-zinc-200 mt-6 mb-2 scroll-mt-4"
                                {...props}
                              >
                                {children}
                              </h2>
                            );
                          },
                          h3: ({ children, ...props }) => {
                            const id = String(children)
                              .toLowerCase()
                              .replace(/[^\w\s-]/g, "")
                              .trim()
                              .replace(/\s+/g, "-");
                            return (
                              <h3
                                id={id}
                                className="text-sm font-semibold text-zinc-300 mt-4 mb-1.5 scroll-mt-4"
                                {...props}
                              >
                                {children}
                              </h3>
                            );
                          },
                          a({ href, children }) {
                            return (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 underline underline-offset-2 hover:text-blue-300 transition-colors"
                              >
                                {children}
                              </a>
                            );
                          },
                          table({ children }) {
                            return (
                              <div className="overflow-x-auto my-4">
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
                          code({ className, children, ...props }) {
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
                        }}
                      >
                        {displayReport}
                      </ReactMarkdown>
                    </div>

                    {/* Sources */}
                    {viewingReport && viewingReport.sources.length > 0 && (
                      <div className="mt-8 pt-4 border-t border-zinc-800">
                        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                          Sources
                        </p>
                        <div className="space-y-1.5">
                          {viewingReport.sources.map((s, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className="text-zinc-600 font-mono w-6 flex-shrink-0">
                                [{i + 1}]
                              </span>
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 underline underline-offset-2 truncate"
                              >
                                {s.title || s.url}
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                </div>
              </div>
            )}

            {/* Error state */}
            {phase === "error" && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
                <div className="w-12 h-12 rounded-full bg-red-950 flex items-center justify-center">
                  <X size={20} className="text-red-400" />
                </div>
                <p className="text-sm font-semibold text-zinc-300">
                  Research failed
                </p>
                <p className="text-xs text-zinc-500 max-w-sm text-center">
                  {error}
                </p>
                <button
                  onClick={() => setPhase("idle")}
                  className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 underline"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
