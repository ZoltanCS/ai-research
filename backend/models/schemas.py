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
    provider: str = Field(default="ollama", pattern="^(ollama|openai|anthropic)$")
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
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentChunkOut(BaseModel):
    id: uuid.UUID
    chunk_index: int
    content: str
    score: float | None = None

    model_config = {"from_attributes": True}


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


class ProvidersStatusResponse(BaseModel):
    ollama: ProviderStatusOut
    openai: ProviderStatusOut
    anthropic: ProviderStatusOut


# ── Research ──────────────────────────────────────────────────────────────────

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
