"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import {
  FlaskConical,
  File,
  Folder,
  FolderOpen,
  Plus,
  Trash2,
  Save,
  Play,
  Eye,
  Terminal,
  Send,
  Square,
  RefreshCw,
  Brain,
  User,
  ChevronRight,
  FileCode,
  Globe,
  FilePen,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/store";
import {
  labsListFiles,
  labsReadFile,
  labsWriteFile,
  labsDeleteFile,
  labsRenameFile,
  labsExecute,
  streamLabsChat,
  type FileNode,
  type LabsToolEvent,
} from "@/lib/api";

// ── Helpers ────────────────────────────────────────────────────────────────────

function langFromExt(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    py: "python", js: "javascript", ts: "typescript", tsx: "tsx",
    jsx: "jsx", html: "html", css: "css", json: "json",
    md: "markdown", sh: "bash", txt: "text", yaml: "yaml", yml: "yaml",
    toml: "toml", rs: "rust", go: "go", java: "java", cpp: "cpp", c: "c",
  };
  return map[ext] ?? "text";
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["py"].includes(ext)) return <span className="text-yellow-400">🐍</span>;
  if (["js", "ts", "jsx", "tsx"].includes(ext)) return <span className="text-yellow-300">⚡</span>;
  if (["html", "htm"].includes(ext)) return <span className="text-orange-400">🌐</span>;
  if (["css"].includes(ext)) return <span className="text-blue-400">🎨</span>;
  if (["json", "yaml", "yml", "toml"].includes(ext)) return <span className="text-purple-400">⚙</span>;
  if (["md", "txt"].includes(ext)) return <span className="text-zinc-400">📄</span>;
  if (["sh", "bash"].includes(ext)) return <span className="text-green-400">$</span>;
  return <FileCode size={13} className="text-zinc-500" />;
}

function canPreview(name: string) {
  return ["html", "htm", "svg"].includes(name.split(".").pop()?.toLowerCase() ?? "");
}

function canRun(name: string) {
  return ["py", "js", "sh"].includes(name.split(".").pop()?.toLowerCase() ?? "");
}

function runLang(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "py") return "python";
  if (ext === "js") return "javascript";
  return "bash";
}

// ── File Explorer ─────────────────────────────────────────────────────────────

interface ExplorerProps {
  files: FileNode[];
  activeFile: string | null;
  onOpen: (path: string) => void;
  onDelete: (path: string) => void;
  onRefresh: () => void;
  onNewFile: (name: string) => void;
}

function FileTree({
  nodes,
  depth,
  activeFile,
  onOpen,
  onDelete,
}: {
  nodes: FileNode[];
  depth: number;
  activeFile: string | null;
  onOpen: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <>
      {nodes.map((node) => {
        const isDir = node.type === "directory";
        const isActive = node.path === activeFile;
        const isOpen = expanded[node.path];

        return (
          <div key={node.path}>
            <div
              className={`group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-xs transition-colors ${
                isActive
                  ? "bg-blue-600/20 text-blue-300"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              onClick={() => {
                if (isDir) {
                  setExpanded((prev) => ({ ...prev, [node.path]: !prev[node.path] }));
                } else {
                  onOpen(node.path);
                }
              }}
            >
              {isDir ? (
                <>
                  <ChevronRight
                    size={10}
                    className={`flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  {isOpen ? (
                    <FolderOpen size={13} className="flex-shrink-0 text-yellow-400" />
                  ) : (
                    <Folder size={13} className="flex-shrink-0 text-yellow-400" />
                  )}
                </>
              ) : (
                <>
                  <span className="w-2.5 flex-shrink-0" />
                  <span className="flex-shrink-0">{fileIcon(node.name)}</span>
                </>
              )}
              <span className="truncate flex-1">{node.name}</span>
              {!isDir && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(node.path);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-600 hover:text-red-400 rounded transition-all flex-shrink-0"
                  title="Delete"
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>
            {isDir && isOpen && node.children && node.children.length > 0 && (
              <FileTree
                nodes={node.children}
                depth={depth + 1}
                activeFile={activeFile}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function FileExplorer({ files, activeFile, onOpen, onDelete, onRefresh, onNewFile }: ExplorerProps) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = () => {
    if (!newName.trim()) return;
    onNewFile(newName.trim());
    setNewName("");
    setCreating(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
          Workspace
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCreating(true)}
            title="New file"
            className="p-1 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={onRefresh}
            title="Refresh"
            className="p-1 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1 min-h-0">
        {files.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-zinc-600">
            <FlaskConical size={20} className="mx-auto mb-2 opacity-30" />
            Empty workspace
          </div>
        ) : (
          <FileTree
            nodes={files}
            depth={0}
            activeFile={activeFile}
            onOpen={onOpen}
            onDelete={onDelete}
          />
        )}
      </div>

      {/* New file input */}
      {creating && (
        <div className="px-2 pb-2 border-t border-zinc-800 pt-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="filename.py"
            className="w-full px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-1 mt-1">
            <button
              onClick={handleCreate}
              className="flex-1 text-xs py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => setCreating(false)}
              className="px-2 text-xs py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Code Editor ───────────────────────────────────────────────────────────────

interface EditorProps {
  filename: string | null;
  content: string;
  onChange: (v: string) => void;
  onSave: () => void;
  isDirty: boolean;
}

function CodeEditor({ filename, content, onChange, onSave, isDirty }: EditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+S / Cmd+S to save
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      onSave();
      return;
    }
    // Tab → 2 spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = taRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = content.slice(0, start) + "  " + content.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  const lang = filename ? langFromExt(filename) : "text";

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          {filename ? (
            <>
              <FilePen size={13} className="text-zinc-500" />
              <span className="text-xs text-zinc-300 font-mono">{filename}</span>
              {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-orange-400" title="Unsaved" />}
            </>
          ) : (
            <span className="text-xs text-zinc-600">No file selected</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-600 font-mono">{lang}</span>
          <button
            onClick={onSave}
            disabled={!filename || !isDirty}
            title="Save (Ctrl+S)"
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none rounded transition-colors"
          >
            <Save size={10} />
            Save
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-auto min-h-0 bg-zinc-950">
        {filename ? (
          <textarea
            ref={taRef}
            value={content}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            className="w-full h-full min-h-full resize-none bg-transparent text-zinc-200 font-mono text-[13px] leading-relaxed p-4 focus:outline-none"
            style={{ tabSize: 2 }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-700 text-sm">
            Select or create a file to edit
          </div>
        )}
      </div>

      {/* Status bar */}
      {filename && (
        <div className="flex items-center gap-3 px-3 py-1 bg-zinc-900 border-t border-zinc-800 flex-shrink-0">
          <span className="text-[10px] text-zinc-600">
            {content.split("\n").length} lines
          </span>
          <span className="text-[10px] text-zinc-600">
            {new Blob([content]).size} bytes
          </span>
          <span className="text-[10px] text-zinc-600 ml-auto">
            Ctrl+S to save · Tab for indent
          </span>
        </div>
      )}
    </div>
  );
}

// ── Labs Chat ─────────────────────────────────────────────────────────────────

interface LabsChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolEvents?: LabsToolEvent[];
  isStreaming?: boolean;
}

interface ChatProps {
  onFilesChanged: () => void;
}

function LabsChat({ onFilesChanged }: ChatProps) {
  const { selectedModel, selectedProvider } = useStore();
  const [messages, setMessages] = useState<LabsChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    const userContent = input.trim();
    setInput("");

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: userContent },
      { id: assistantId, role: "assistant", content: "", isStreaming: true, toolEvents: [] },
    ]);
    setIsStreaming(true);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const apiMessages = [
      ...messages
        .filter((m) => m.content.trim())
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userContent },
    ];

    let fileChanged = false;

    try {
      await streamLabsChat({
        messages: apiMessages,
        model: selectedModel,
        provider: selectedProvider,
        onToken: (token) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + token } : m
            )
          );
        },
        onDone: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, isStreaming: false } : m
            )
          );
          setIsStreaming(false);
          if (fileChanged) onFilesChanged();
        },
        onError: (err) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + `\n\n⚠️ ${err}`, isStreaming: false }
                : m
            )
          );
          setIsStreaming(false);
          toast.error(err);
        },
        onToolEvent: (event) => {
          if (["write_file", "delete_file", "rename_file"].includes(event.name)) {
            fileChanged = true;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, toolEvents: [...(m.toolEvents ?? []), event] }
                : m
            )
          );
        },
        signal: abortRef.current.signal,
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        setIsStreaming(false);
        toast.error(e.message);
      }
    }
  }, [input, isStreaming, messages, selectedModel, selectedProvider, onFilesChanged]);

  const handleStop = () => {
    abortRef.current?.abort();
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
    );
    setIsStreaming(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 flex-shrink-0">
        <Brain size={13} className="text-blue-400" />
        <span className="text-xs font-semibold text-zinc-400">AI Agent</span>
        <span className="ml-auto text-[10px] text-zinc-600 font-mono truncate max-w-[120px]">
          {selectedProvider}/{selectedModel}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-zinc-600">
            <FlaskConical size={24} className="opacity-30" />
            <p className="text-xs">Ask the AI to create files, write code, or run programs.</p>
            <div className="flex flex-col gap-1 text-[10px] text-left w-full">
              {[
                "Create a Python web scraper",
                "Build a snake game in HTML",
                "Write and run a sorting algorithm",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="px-2.5 py-1.5 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="animate-in fade-in slide-in-from-bottom-2 duration-200">
            {msg.role === "user" ? (
              <div className="flex gap-2 justify-end">
                <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3 py-2 text-xs leading-relaxed max-w-[85%] whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
                <div className="w-6 h-6 rounded-full bg-blue-600 flex-shrink-0 flex items-center justify-center mt-0.5">
                  <User size={11} className="text-white" />
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-zinc-700 flex-shrink-0 flex items-center justify-center mt-0.5">
                  <Brain size={11} className="text-zinc-300" />
                </div>
                <div className="flex-1 min-w-0">
                  {/* Tool events */}
                  {msg.toolEvents && msg.toolEvents.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {msg.toolEvents.map((ev, i) => (
                        <div
                          key={i}
                          className={`flex items-start gap-1.5 text-[10px] rounded-lg px-2 py-1 ${
                            ev.type === "tool_call"
                              ? "bg-zinc-800/60 text-zinc-400"
                              : "bg-zinc-900/60 text-zinc-500"
                          }`}
                        >
                          <span className="flex-shrink-0 mt-px">
                            {ev.type === "tool_call" ? "⚙" : "✓"}
                          </span>
                          <div className="min-w-0">
                            <span className="font-mono text-zinc-300">{ev.name}</span>
                            {ev.type === "tool_call" && ev.args && (
                              <span className="text-zinc-600 ml-1">
                                {Object.entries(ev.args)
                                  .filter(([k]) => k !== "content")
                                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                                  .join(", ")}
                              </span>
                            )}
                            {ev.type === "tool_result" && ev.result && (
                              <span className="text-zinc-600 ml-1 truncate block">
                                {ev.result.slice(0, 80)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Text content */}
                  {msg.content ? (
                    <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">
                      {msg.content}
                    </p>
                  ) : msg.isStreaming ? (
                    <span className="typing-cursor text-zinc-500 text-xs" />
                  ) : null}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-zinc-800 p-2">
        <div className="flex items-end gap-2 bg-zinc-900/80 rounded-xl border border-zinc-800 px-2.5 py-2 focus-within:border-zinc-600 transition-colors">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Ask AI to build something…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none leading-5 max-h-28"
          />
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="flex-shrink-0 p-1.5 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-white transition-colors"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="flex-shrink-0 p-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-lg text-white transition-colors"
            >
              <Send size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main LabsPage ─────────────────────────────────────────────────────────────

type TabId = "code" | "preview" | "terminal";

export default function LabsPage() {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("code");
  const [execResult, setExecResult] = useState<{ stdout: string; stderr: string; exit_code: number } | null>(null);
  const [running, setRunning] = useState(false);

  const isDirty = fileContent !== savedContent;

  // ── File ops ────────────────────────────────────────────────────────────────

  const refreshFiles = useCallback(async () => {
    try {
      const f = await labsListFiles();
      setFiles(f);
    } catch {
      // silently ignore if backend unavailable
    }
  }, []);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  const openFile = useCallback(async (path: string) => {
    try {
      const content = await labsReadFile(path);
      setActiveFile(path);
      setFileContent(content);
      setSavedContent(content);
      setActiveTab("code");
    } catch (e) {
      toast.error(`Failed to open ${path}`);
    }
  }, []);

  const saveFile = useCallback(async () => {
    if (!activeFile) return;
    try {
      await labsWriteFile(activeFile, fileContent);
      setSavedContent(fileContent);
      toast.success(`Saved ${activeFile}`);
      await refreshFiles();
    } catch {
      toast.error("Save failed");
    }
  }, [activeFile, fileContent, refreshFiles]);

  const deleteFile = useCallback(async (path: string) => {
    if (!confirm(`Delete ${path}?`)) return;
    try {
      await labsDeleteFile(path);
      if (activeFile === path) {
        setActiveFile(null);
        setFileContent("");
        setSavedContent("");
      }
      await refreshFiles();
      toast.success("Deleted");
    } catch {
      toast.error("Delete failed");
    }
  }, [activeFile, refreshFiles]);

  const createFile = useCallback(async (name: string) => {
    try {
      await labsWriteFile(name, "");
      await refreshFiles();
      await openFile(name);
    } catch {
      toast.error("Could not create file");
    }
  }, [refreshFiles, openFile]);

  const runFile = useCallback(async () => {
    if (!activeFile || !canRun(activeFile)) return;
    setRunning(true);
    setActiveTab("terminal");
    try {
      // Save first if dirty
      if (isDirty) {
        await labsWriteFile(activeFile, fileContent);
        setSavedContent(fileContent);
        await refreshFiles();
      }
      const result = await labsExecute(fileContent, runLang(activeFile));
      setExecResult(result);
    } catch (e) {
      toast.error("Execution failed");
    } finally {
      setRunning(false);
    }
  }, [activeFile, fileContent, isDirty, refreshFiles]);

  const filename = activeFile ? activeFile.split("/").pop() ?? activeFile : null;

  return (
    <div className="flex h-full bg-[#0a0a0a] overflow-hidden">
      {/* ── Left: File Explorer (240px) ─────────────────────────────────── */}
      <div className="w-60 flex-shrink-0 border-r border-zinc-800 bg-[#111111] flex flex-col">
        <FileExplorer
          files={files}
          activeFile={activeFile}
          onOpen={openFile}
          onDelete={deleteFile}
          onRefresh={refreshFiles}
          onNewFile={createFile}
        />
      </div>

      {/* ── Center: Editor + Preview + Terminal ──────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-zinc-800">
        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-zinc-800 bg-[#111111] flex-shrink-0">
          {(["code", "preview", "terminal"] as TabId[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs border-b-2 transition-colors capitalize ${
                activeTab === tab
                  ? "border-blue-500 text-zinc-100 bg-[#0a0a0a]"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {tab === "code" && <FileCode size={11} />}
              {tab === "preview" && <Eye size={11} />}
              {tab === "terminal" && <Terminal size={11} />}
              {tab}
            </button>
          ))}

          {/* Run button */}
          {activeFile && canRun(activeFile) && (
            <button
              onClick={runFile}
              disabled={running}
              title="Run file"
              className="ml-auto mr-2 flex items-center gap-1 px-2.5 py-1 text-[11px] bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-lg transition-colors disabled:opacity-50"
            >
              <Play size={10} fill="currentColor" />
              {running ? "Running…" : "Run"}
            </button>
          )}
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTab === "code" && (
            <CodeEditor
              filename={filename}
              content={fileContent}
              onChange={setFileContent}
              onSave={saveFile}
              isDirty={isDirty}
            />
          )}

          {activeTab === "preview" && (
            <div className="h-full bg-white overflow-hidden">
              {activeFile && canPreview(activeFile) ? (
                <iframe
                  key={savedContent}
                  srcDoc={savedContent || fileContent}
                  sandbox="allow-scripts"
                  className="w-full h-full border-none"
                  title="Preview"
                />
              ) : (
                <div className="flex items-center justify-center h-full bg-[#0a0a0a] text-zinc-600 text-sm gap-2">
                  <Globe size={16} />
                  <span>
                    {activeFile
                      ? "Preview available for HTML/SVG files"
                      : "No file selected"}
                  </span>
                </div>
              )}
            </div>
          )}

          {activeTab === "terminal" && (
            <div className="h-full flex flex-col bg-black">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 flex-shrink-0">
                <Terminal size={11} className="text-green-400" />
                <span className="text-[10px] text-zinc-500 font-mono">
                  {running ? "Running…" : execResult ? `Exit ${execResult.exit_code}` : "Output"}
                </span>
                {execResult && (
                  <button
                    onClick={() => setExecResult(null)}
                    className="ml-auto text-zinc-700 hover:text-zinc-400 transition-colors"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-3 font-mono text-xs">
                {running && (
                  <div className="flex items-center gap-2 text-green-400">
                    <span className="animate-pulse">▋</span>
                    <span>Running {filename}…</span>
                  </div>
                )}
                {execResult && !running && (
                  <>
                    {execResult.stdout && (
                      <pre className="text-green-300 whitespace-pre-wrap">{execResult.stdout}</pre>
                    )}
                    {execResult.stderr && (
                      <pre className="text-red-400 whitespace-pre-wrap">{execResult.stderr}</pre>
                    )}
                    {!execResult.stdout && !execResult.stderr && (
                      <span className="text-zinc-600">(no output)</span>
                    )}
                    <div className="mt-2 text-zinc-600 text-[10px]">
                      Exit code: {execResult.exit_code}
                    </div>
                  </>
                )}
                {!running && !execResult && (
                  <span className="text-zinc-700">
                    {activeFile && canRun(activeFile)
                      ? "Click Run to execute the current file"
                      : "Select a runnable file (.py, .js, .sh)"}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: AI Chat (320px) ──────────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 flex flex-col bg-[#111111]">
        <LabsChat onFilesChanged={refreshFiles} />
      </div>
    </div>
  );
}
