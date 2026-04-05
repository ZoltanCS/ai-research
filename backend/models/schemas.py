import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# ── Shared building blocks ────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    """A single turn in a conversation (OpenAI-compatible format)."""
    role: str = Field(..., pattern="^(system|user|assistant)$")
    content: str = Field(..., min_length=1)


# ── Chat (legacy single-message endpoint) ────────────────────────────────────

class ChatRequest(BaseModel):
    """Legacy endpoint schema used by POST /api/chat."""
    message: str = Field(..., min_length=1, max_length=10000)
    conversation_id: uuid.UUID | None = None
    use_rag: bool = False
    use_web_search: bool = False
    stream: bool = True


# ── Chat (new multi-message endpoints) ───────────────────────────────────────

class StreamChatRequest(BaseModel):
    """Request body for POST /api/chat/stream and POST /api/chat/complete."""
    messages: list[ChatMessage] = Field(..., min_length=1)
    model: str = Field(..., min_length=1)
    provider: str = Field(default="ollama", pattern="^(ollama|openai|anthropic|cerebras|vercel)$")
    system_prompt: str | None = Field(default=None, max_length=8000)
    conversation_id: uuid.UUID | None = None
    use_rag: bool = False
    use_web_search: bool = False


class CompleteChatRequest(StreamChatRequest):
    """Same shape as StreamChatRequest; separate type for documentation clarity."""


# ── SSE event envelope ────────────────────────────────────────────────────────

class SSEToken(BaseModel):
    """Emitted for each streamed token."""
    delta: str


class SSEDone(BaseModel):
    """Final SSE event signalling stream completion."""
    done: bool = True
    conversation_id: str | None = None


# ── Conversations ─────────────────────────────────────────────────────────────

class SaveConversationRequest(BaseModel):
    """Persist a full conversation (title + messages) in one call."""
    title: str = Field(default="New Chat", max_length=255)
    messages: list[ChatMessage]
    provider: str | None = None
    model: str | None = None


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationOut(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class ConversationDetailOut(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[MessageOut] = []

    model_config = {"from_attributes": True}


# ── Documents ─────────────────────────────────────────────────────────────────

class DocumentOut(BaseModel):
    id: uuid.UUID
    filename: str
    content_type: str
    chunk_count: int
    file_size: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentChunkOut(BaseModel):
    id: uuid.UUID
    chunk_index: int
    token_count: int | None = None
    content: str
    score: float | None = None

    model_config = {"from_attributes": True}


# ── RAG ───────────────────────────────────────────────────────────────────────

class RAGQueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(default=6, ge=1, le=20)
    # Alpha controls semantic vs keyword weighting: 1.0 = pure semantic
    hybrid_alpha: float = Field(default=0.7, ge=0.0, le=1.0)
    # Optionally filter to specific documents
    document_ids: list[uuid.UUID] | None = None
    # When True, also return the assembled prompt-ready context string
    include_context: bool = False


class RetrievedChunkOut(BaseModel):
    """A single chunk returned by the retrieval pipeline."""
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    filename: str
    chunk_index: int
    content: str
    semantic_score: float
    keyword_score: float
    combined_score: float

    model_config = {"from_attributes": True}


class RAGQueryResponse(BaseModel):
    query: str
    chunks: list[RetrievedChunkOut]
    # Only present when include_context=True
    context: str | None = None
    # Metadata
    semantic_search_ms: float | None = None
    keyword_search_ms: float | None = None
    total_ms: float | None = None


# ── Web search ────────────────────────────────────────────────────────────────

class WebSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    max_results: int = Field(default=5, ge=1, le=20)
    include_content: bool = Field(
        default=False,
        description="Scrape full page content for each result",
    )


class WebSearchResultOut(BaseModel):
    title: str
    url: str
    snippet: str
    content: str | None = None   # full scraped content, if include_content=True
    score: float | None = None
    provider: str             # "tavily" | "searxng"


class WebSearchResponse(BaseModel):
    query: str
    results: list[WebSearchResultOut]
    answer: str | None = None  # AI-generated answer from Tavily
    cached: bool = False
    provider: str             # which backend was used


# ── Models / providers ────────────────────────────────────────────────────────

class ModelInfoOut(BaseModel):
    id: str
    name: str
    provider: str
    context_length: int | None = None


class ProviderStatusOut(BaseModel):
    status: str  # "ok" | "error" | "unconfigured"
    detail: str | None = None
    host: str | None = None
    model_count: int | None = None


class AllModelsResponse(BaseModel):
    ollama: list[ModelInfoOut] = []
    openai: list[ModelInfoOut] = []
    anthropic: list[ModelInfoOut] = []
    cerebras: list[ModelInfoOut] = []
    vercel: list[ModelInfoOut] = []


class ProvidersStatusResponse(BaseModel):
    ollama: ProviderStatusOut
    openai: ProviderStatusOut
    anthropic: ProviderStatusOut
    cerebras: ProviderStatusOut
    vercel: ProviderStatusOut


# ── Research (deep agent) ─────────────────────────────────────────────────────

class ResearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    model: str = Field(..., min_length=1)
    provider: str = Field(default="ollama", pattern="^(ollama|openai|anthropic|cerebras|vercel)$")
    max_sub_questions: int = Field(default=10, ge=1, le=30)
    max_results_per_query: int = Field(default=10, ge=1, le=50)
    top_k_sources: int = Field(default=100, ge=1, le=200)


class ResearchSourceOut(BaseModel):
    title: str
    url: str
    query: str


class ResearchReportOut(BaseModel):
    id: uuid.UUID
    query: str
    sub_questions: list[str]
    sources: list[ResearchSourceOut]
    report: str
    model: str
    provider: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Research (legacy) ─────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    max_results: int = Field(default=5, ge=1, le=20)
    include_answer: bool = True


class SearchResult(BaseModel):
    title: str
    url: str
    content: str
    score: float | None = None


class SearchResponse(BaseModel):
    query: str
    answer: str | None = None
    results: list[SearchResult] = []


# ── Health ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    app: str


# ── Auth ──────────────────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=8)


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    email: str
    is_admin: bool
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ── Admin settings ────────────────────────────────────────────────────────────

class GlobalSettingsUpdate(BaseModel):
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    cerebras_api_key: str = ""
    vercel_api_token: str = ""
    vercel_gateway_url: str = ""
    ollama_host: str = ""


class GlobalSettingsOut(BaseModel):
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    cerebras_api_key: str = ""
    vercel_api_token: str = ""
    vercel_gateway_url: str = ""
    ollama_host: str = ""
