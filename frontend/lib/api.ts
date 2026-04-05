import { useStore } from "@/store";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Read provider credentials from the Zustand store and return them as HTTP headers. */
function credHeaders(): Record<string, string> {
  const s = useStore.getState();
  const k = s.providerKeys;
  const h: Record<string, string> = {};
  if (s.authToken) h["Authorization"] = `Bearer ${s.authToken}`;
  if (k.openai) h["X-OpenAI-Key"] = k.openai;
  if (k.anthropic) h["X-Anthropic-Key"] = k.anthropic;
  if (k.cerebras) h["X-Cerebras-Key"] = k.cerebras;
  if (k.vercel) h["X-Vercel-Token"] = k.vercel;
  if (k.vercelGateway) h["X-Vercel-Gateway"] = k.vercelGateway;
  if (s.ollamaHost) h["X-Ollama-Host"] = s.ollamaHost;
  return h;
}

// ── Base types ────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface Document {
  id: string;
  filename: string;
  content_type: string;
  chunk_count: number;
  file_size?: number | null;
  created_at: string;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface SearchResponse {
  query: string;
  answer?: string;
  results: SearchResult[];
}

// ── Models / Providers ────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  context_length?: number;
}

export interface AllModels {
  ollama: ModelInfo[];
  openai: ModelInfo[];
  anthropic: ModelInfo[];
  cerebras: ModelInfo[];
  vercel: ModelInfo[];
}

export interface ProviderStatus {
  status: "ok" | "error" | "unconfigured";
  detail?: string;
  host?: string;
  model_count?: number;
}

export async function getModels(): Promise<AllModels> {
  const res = await fetch(`${API_BASE}/api/models`, { headers: credHeaders() });
  if (!res.ok) throw new Error("Failed to fetch models");
  return res.json();
}

export async function getProviderStatus(): Promise<
  Record<string, ProviderStatus>
> {
  const res = await fetch(`${API_BASE}/api/providers/status`, { headers: credHeaders() });
  if (!res.ok) throw new Error("Failed to fetch provider status");
  return res.json();
}

// ── Chat (new streaming endpoint) ─────────────────────────────────────────────

export interface ToolCallEvent {
  type: "web_search";
  query: string;
}

export interface ToolResultEvent {
  count: number;
}

export async function streamChatMessage(params: {
  messages: Array<{ role: string; content: string }>;
  model: string;
  provider: string;
  systemPrompt?: string;
  conversationId?: string | null;
  useRag?: boolean;
  useWebSearch?: boolean;
  onToken: (token: string) => void;
  onDone: (conversationId: string | null) => void;
  onError: (error: string) => void;
  onToolCall?: (tool: ToolCallEvent) => void;
  onToolResult?: (result: ToolResultEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...credHeaders() },
    body: JSON.stringify({
      messages: params.messages,
      model: params.model,
      provider: params.provider,
      system_prompt: params.systemPrompt ?? null,
      conversation_id: params.conversationId ?? null,
      use_rag: params.useRag ?? false,
      use_web_search: params.useWebSearch ?? false,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const err = await response.text();
    params.onError(err);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const event = JSON.parse(raw);
          if (typeof event.delta === "string") {
            params.onToken(event.delta);
          } else if (event.done === true) {
            params.onDone(event.conversation_id ?? null);
            return;
          } else if (typeof event.error === "string") {
            params.onError(event.error);
            return;
          } else if (event.tool_call === "web_search" && typeof event.query === "string") {
            params.onToolCall?.({ type: "web_search", query: event.query });
          } else if (event.tool_result === true) {
            params.onToolResult?.({ count: event.count as number });
          }
        } catch {
          // malformed JSON line — skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Chat (legacy single-message endpoint, kept for compatibility) ──────────────

export async function sendMessage(params: {
  message: string;
  conversationId?: string;
  useRag?: boolean;
  useWebSearch?: boolean;
  onToken: (token: string) => void;
  onDone: (conversationId: string) => void;
  onError: (error: string) => void;
}) {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...credHeaders() },
    body: JSON.stringify({
      message: params.message,
      conversation_id: params.conversationId ?? null,
      use_rag: params.useRag ?? false,
      use_web_search: params.useWebSearch ?? false,
      stream: true,
    }),
  });

  if (!response.ok) {
    params.onError(await response.text());
    return;
  }

  const conversationId = response.headers.get("X-Conversation-Id") ?? "";
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") { params.onDone(conversationId); return; }
        params.onToken(data);
      }
    }
  }
}

// ── Conversations ─────────────────────────────────────────────────────────────

export async function getConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/api/chat/conversations`, { headers: credHeaders() });
  if (!res.ok) throw new Error("Failed to fetch conversations");
  return res.json();
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const res = await fetch(`${API_BASE}/api/chat/conversations/${id}`, { headers: credHeaders() });
  if (!res.ok) throw new Error("Failed to fetch conversation");
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/conversations/${id}`, {
    method: "DELETE",
    headers: credHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete conversation");
}

// ── Documents ─────────────────────────────────────────────────────────────────

export async function uploadDocument(file: File): Promise<Document> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/documents`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail ?? "Upload failed");
  }
  return res.json();
}

/** Upload a document and report progress (0-100) via onProgress callback. */
export function uploadDocumentWithProgress(
  file: File,
  onProgress: (pct: number) => void
): Promise<Document> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          reject(new Error(JSON.parse(xhr.responseText)?.detail ?? "Upload failed"));
        } catch {
          reject(new Error("Upload failed"));
        }
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.open("POST", `${API_BASE}/api/documents`);
    const ch = credHeaders();
    Object.entries(ch).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.send(formData);
  });
}

export async function getDocuments(): Promise<Document[]> {
  const res = await fetch(`${API_BASE}/api/documents`, { headers: credHeaders() });
  if (!res.ok) throw new Error("Failed to fetch documents");
  return res.json();
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/documents/${id}`, {
    method: "DELETE",
    headers: credHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete document");
}

// ── Research ──────────────────────────────────────────────────────────────────

export interface ResearchSource {
  title: string;
  url: string;
  query: string;
}

export interface ResearchReport {
  id: string;
  query: string;
  sub_questions: string[];
  sources: ResearchSource[];
  report: string;
  model: string;
  provider: string;
  created_at: string;
}

export type ResearchEvent =
  | { type: "progress"; step: string; message: string; detail?: Record<string, unknown> }
  | { type: "token"; delta: string }
  | { type: "complete"; report_id: string; report: string }
  | { type: "error"; message: string };

export async function startResearch(params: {
  query: string;
  model: string;
  provider: string;
  maxSubQuestions?: number;
  maxResultsPerQuery?: number;
  topKSources?: number;
  onEvent: (event: ResearchEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch(`${API_BASE}/api/research/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...credHeaders() },
    body: JSON.stringify({
      query: params.query,
      model: params.model,
      provider: params.provider,
      max_sub_questions: params.maxSubQuestions ?? 4,
      max_results_per_query: params.maxResultsPerQuery ?? 5,
      top_k_sources: params.topKSources ?? 6,
    }),
    signal: params.signal,
  });

  if (!response.ok) throw new Error(await response.text());

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          params.onEvent(JSON.parse(raw) as ResearchEvent);
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function getResearchReports(): Promise<ResearchReport[]> {
  const res = await fetch(`${API_BASE}/api/research/reports`, { headers: credHeaders() });
  if (!res.ok) throw new Error("Failed to fetch research reports");
  return res.json();
}

export async function getResearchReport(id: string): Promise<ResearchReport> {
  const res = await fetch(`${API_BASE}/api/research/reports/${id}`, { headers: credHeaders() });
  if (!res.ok) throw new Error("Failed to fetch research report");
  return res.json();
}

export async function webSearch(
  query: string,
  maxResults = 5
): Promise<SearchResponse> {
  const res = await fetch(`${API_BASE}/api/research/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...credHeaders() },
    body: JSON.stringify({ query, max_results: maxResults, include_answer: true }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail ?? "Search failed");
  }
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    const msg = Array.isArray(err.detail)
      ? err.detail.map((e: { msg: string }) => e.msg).join(", ")
      : err.detail ?? "Login failed";
    throw new Error(msg);
  }
  return res.json();
}

export async function register(username: string, email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    const msg = Array.isArray(err.detail)
      ? err.detail.map((e: { msg: string }) => e.msg).join(", ")
      : err.detail ?? "Registration failed";
    throw new Error(msg);
  }
  return res.json();
}

// ── Admin settings ─────────────────────────────────────────────────────────────

export interface AdminSettings {
  openai_api_key: string;
  anthropic_api_key: string;
  cerebras_api_key: string;
  vercel_api_token: string;
  vercel_gateway_url: string;
  ollama_host: string;
}

export async function getAdminSettings(): Promise<AdminSettings> {
  const res = await fetch(`${API_BASE}/api/admin/settings`, { headers: credHeaders() });
  if (!res.ok) throw new Error("Failed to fetch admin settings");
  return res.json();
}

export async function updateAdminSettings(settings: AdminSettings): Promise<AdminSettings> {
  const res = await fetch(`${API_BASE}/api/admin/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...credHeaders() },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error("Failed to update admin settings");
  return res.json();
}
