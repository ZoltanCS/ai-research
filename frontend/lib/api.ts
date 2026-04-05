const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
}

export interface ProviderStatus {
  status: "ok" | "error" | "unconfigured";
  detail?: string;
  host?: string;
  model_count?: number;
}

export async function getModels(): Promise<AllModels> {
  const res = await fetch(`${API_BASE}/api/models`);
  if (!res.ok) throw new Error("Failed to fetch models");
  return res.json();
}

export async function getProviderStatus(): Promise<
  Record<string, ProviderStatus>
> {
  const res = await fetch(`${API_BASE}/api/providers/status`);
  if (!res.ok) throw new Error("Failed to fetch provider status");
  return res.json();
}

// ── Chat (new streaming endpoint) ─────────────────────────────────────────────

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
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
  const res = await fetch(`${API_BASE}/api/chat/conversations`);
  if (!res.ok) throw new Error("Failed to fetch conversations");
  return res.json();
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const res = await fetch(`${API_BASE}/api/chat/conversations/${id}`);
  if (!res.ok) throw new Error("Failed to fetch conversation");
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/conversations/${id}`, {
    method: "DELETE",
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

export async function getDocuments(): Promise<Document[]> {
  const res = await fetch(`${API_BASE}/api/documents`);
  if (!res.ok) throw new Error("Failed to fetch documents");
  return res.json();
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/documents/${id}`, {
    method: "DELETE",
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
    headers: { "Content-Type": "application/json" },
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
  const res = await fetch(`${API_BASE}/api/research/reports`);
  if (!res.ok) throw new Error("Failed to fetch research reports");
  return res.json();
}

export async function getResearchReport(id: string): Promise<ResearchReport> {
  const res = await fetch(`${API_BASE}/api/research/reports/${id}`);
  if (!res.ok) throw new Error("Failed to fetch research report");
  return res.json();
}

export async function webSearch(
  query: string,
  maxResults = 5
): Promise<SearchResponse> {
  const res = await fetch(`${API_BASE}/api/research/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: maxResults, include_answer: true }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail ?? "Search failed");
  }
  return res.json();
}
