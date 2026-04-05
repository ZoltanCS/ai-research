"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import {
  FileText,
  Upload,
  Trash2,
  MessageSquare,
  File,
  X,
  Eye,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  getDocuments,
  deleteDocument,
  uploadDocumentWithProgress,
  type Document,
} from "@/lib/api";
import { formatDate, formatFileSize } from "@/lib/utils";
import { useStore } from "@/store";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UploadingFile {
  id: string;
  name: string;
  size: number;
  progress: number; // 0-100
  status: "uploading" | "done" | "error";
  error?: string;
}

// ── Accept config ─────────────────────────────────────────────────────────────

const ACCEPT = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
};

const ACCEPT_LABEL = "PDF, DOCX, TXT, MD";

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
      <div
        className="h-full bg-blue-500 transition-all duration-150"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function UploadItem({ file }: { file: UploadingFile }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 last:border-0">
      <File size={16} className="text-zinc-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-300 truncate">{file.name}</p>
        {file.status === "uploading" && (
          <ProgressBar value={file.progress} />
        )}
        {file.status === "error" && (
          <p className="text-xs text-red-400 mt-0.5">{file.error}</p>
        )}
      </div>
      <div className="flex-shrink-0">
        {file.status === "uploading" && (
          <span className="text-xs text-zinc-500">{file.progress}%</span>
        )}
        {file.status === "done" && (
          <CheckCircle2 size={14} className="text-emerald-400" />
        )}
        {file.status === "error" && (
          <AlertCircle size={14} className="text-red-400" />
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const router = useRouter();
  const { setSettings } = useStore();

  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Load documents ────────────────────────────────────────────────────────

  const refreshDocs = useCallback(() => {
    getDocuments().then(setDocuments).catch(console.error);
  }, []);

  useEffect(() => { refreshDocs(); }, [refreshDocs]);

  // ── Upload handler ────────────────────────────────────────────────────────

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const newItems: UploadingFile[] = acceptedFiles.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        size: f.size,
        progress: 0,
        status: "uploading",
      }));
      setUploading((prev) => [...newItems, ...prev]);

      await Promise.all(
        acceptedFiles.map((file, i) => {
          const itemId = newItems[i].id;
          return uploadDocumentWithProgress(file, (pct) => {
            setUploading((prev) =>
              prev.map((u) => (u.id === itemId ? { ...u, progress: pct } : u))
            );
          })
            .then(() => {
              setUploading((prev) =>
                prev.map((u) =>
                  u.id === itemId ? { ...u, status: "done", progress: 100 } : u
                )
              );
              refreshDocs();
            })
            .catch((err) => {
              setUploading((prev) =>
                prev.map((u) =>
                  u.id === itemId
                    ? { ...u, status: "error", error: err.message }
                    : u
                )
              );
            });
        })
      );

      // Clear finished uploads after a delay
      setTimeout(() => {
        setUploading((prev) => prev.filter((u) => u.status === "uploading"));
      }, 3000);
    },
    [refreshDocs]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    multiple: true,
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (doc: Document) => {
    setDeletingId(doc.id);
    try {
      await deleteDocument(doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      if (selectedDoc?.id === doc.id) {
        setSelectedDoc(null);
        setPreview("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  };

  // ── Preview ───────────────────────────────────────────────────────────────

  const handleSelectDoc = async (doc: Document) => {
    setSelectedDoc(doc);
    setPreview("");
    setLoadingPreview(true);
    // Fetch first chunk content from the RAG API as a quick preview
    try {
      const res = await fetch(
        `/api/documents/${doc.id}/chunks?limit=3`
      );
      if (res.ok) {
        const chunks = await res.json();
        const text = chunks
          .map((c: { content: string }) => c.content)
          .join("\n\n---\n\n");
        setPreview(text.slice(0, 1200));
      } else {
        setPreview("(Preview not available)");
      }
    } catch {
      setPreview("(Preview not available)");
    } finally {
      setLoadingPreview(false);
    }
  };

  // ── Chat with doc ─────────────────────────────────────────────────────────

  const handleChatWithDoc = () => {
    setSettings({ useRag: true });
    router.push("/chat");
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-zinc-800/80">
        <h1 className="text-base font-semibold text-zinc-100">Documents</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Upload files to use as context in your chats via RAG.
        </p>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Dropzone */}
        <div className="px-6 pt-4 pb-3 flex-shrink-0">
          <div
            {...getRootProps()}
            className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 cursor-pointer transition-colors ${
              isDragActive
                ? "border-blue-500 bg-blue-950/20"
                : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/40"
            }`}
          >
            <input {...getInputProps()} />
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isDragActive ? "bg-blue-600" : "bg-zinc-800"
              }`}
            >
              <Upload
                size={18}
                className={isDragActive ? "text-white" : "text-zinc-400"}
              />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-300">
                {isDragActive
                  ? "Drop files here"
                  : "Drag & drop files, or click to browse"}
              </p>
              <p className="text-xs text-zinc-600 mt-0.5">{ACCEPT_LABEL}</p>
            </div>
          </div>
        </div>

        {/* Upload progress queue */}
        {uploading.length > 0 && (
          <div className="mx-6 mb-3 rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden flex-shrink-0">
            <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
              <span className="text-xs font-medium text-zinc-400">
                Uploading {uploading.length} file{uploading.length > 1 ? "s" : ""}
              </span>
              <button
                onClick={() => setUploading([])}
                className="text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
            {uploading.map((f) => (
              <UploadItem key={f.id} file={f} />
            ))}
          </div>
        )}

        {/* Two-column: list + preview */}
        <div className="flex-1 flex min-h-0 gap-0 px-6 pb-6">
          {/* Document list */}
          <div className="flex flex-col w-[340px] flex-shrink-0 mr-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                {documents.length} document{documents.length !== 1 ? "s" : ""}
              </span>
            </div>

            {documents.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
                <FileText size={28} className="text-zinc-700" />
                <p className="text-sm text-zinc-600">No documents yet</p>
                <p className="text-xs text-zinc-700">
                  Upload files to get started
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                {documents.map((doc) => {
                  const isSelected = selectedDoc?.id === doc.id;
                  return (
                    <button
                      key={doc.id}
                      onClick={() => handleSelectDoc(doc)}
                      className={`w-full text-left group flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                        isSelected
                          ? "border-zinc-600 bg-zinc-800"
                          : "border-transparent hover:border-zinc-800 hover:bg-zinc-900"
                      }`}
                    >
                      <FileText
                        size={16}
                        className="text-zinc-500 flex-shrink-0 mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-200 truncate leading-tight">
                          {doc.filename}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-zinc-600">
                            {doc.chunk_count} chunks
                          </span>
                          {doc.file_size != null && (
                            <>
                              <span className="text-zinc-700">·</span>
                              <span className="text-[11px] text-zinc-600">
                                {formatFileSize(doc.file_size)}
                              </span>
                            </>
                          )}
                          <span className="text-zinc-700">·</span>
                          <span className="text-[11px] text-zinc-600">
                            {formatDate(doc.created_at)}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(doc);
                        }}
                        disabled={deletingId === doc.id}
                        className="flex-shrink-0 p-1 text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded disabled:opacity-30"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Preview panel */}
          <div className="flex-1 min-w-0 flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
            {selectedDoc ? (
              <>
                {/* Preview header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 flex-shrink-0">
                  <Eye size={14} className="text-zinc-500" />
                  <span className="text-sm font-medium text-zinc-300 truncate flex-1">
                    {selectedDoc.filename}
                  </span>
                  <button
                    onClick={handleChatWithDoc}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0"
                  >
                    <MessageSquare size={12} />
                    Chat with document
                  </button>
                </div>

                {/* Preview content */}
                <div className="flex-1 overflow-y-auto p-4">
                  {loadingPreview ? (
                    <div className="flex items-center justify-center h-32 text-zinc-600 text-sm">
                      Loading preview…
                    </div>
                  ) : (
                    <>
                      <pre className="text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed">
                        {preview || "(No preview available)"}
                      </pre>
                      {preview.length >= 1200 && (
                        <p className="text-xs text-zinc-600 mt-3 italic">
                          Showing first ~1200 characters
                        </p>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-8">
                <Eye size={24} className="text-zinc-700" />
                <p className="text-sm text-zinc-600">
                  Select a document to preview
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
