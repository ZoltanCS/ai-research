"""Chat API — streaming, non-streaming, and conversation persistence."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from core.database import get_db
from models.database import Conversation, Message
from models.schemas import (
    ChatRequest,
    ChatMessage,
    CompleteChatRequest,
    ConversationDetailOut,
    ConversationOut,
    MessageOut,
    SaveConversationRequest,
    SSEDone,
    SSEToken,
    StreamChatRequest,
)
from services.ai_provider import Provider, ProviderCredentials, stream_chat, stream_chat_with_tools
from services.rag import build_rag_prompt, retrieve_context
from services.search import format_search_context, web_search

router = APIRouter()


def _creds(req: Request) -> ProviderCredentials:
    """Extract provider credentials from custom request headers."""
    return ProviderCredentials(
        openai_key=req.headers.get("X-OpenAI-Key", ""),
        anthropic_key=req.headers.get("X-Anthropic-Key", ""),
        cerebras_key=req.headers.get("X-Cerebras-Key", ""),
        vercel_token=req.headers.get("X-Vercel-Token", ""),
        vercel_gateway_url=req.headers.get("X-Vercel-Gateway", ""),
        ollama_host=req.headers.get("X-Ollama-Host", ""),
    )


DEFAULT_SYSTEM_PROMPT = """\
You are LocalMind, an AI research and chat assistant built to help with in-depth research, \
document analysis, and knowledge synthesis. You are running locally with full privacy.

Your capabilities:
- Answer questions accurately using your training knowledge
- Analyse and summarise uploaded documents (RAG mode)
- Search the web for current information when the web search tool is available
- Run deep multi-step research sessions

When web search is available to you, use it proactively for questions about \
current events, recent data, prices, news, or anything where up-to-date \
information matters. Always cite your sources.

Be concise but thorough. Use markdown formatting for structure when helpful.\
"""

WEB_SEARCH_PROMPT_ADDON = (
    "\n\nYou have access to a `web_search` tool. "
    "Use it whenever the user's question would benefit from current or real-time information."
)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_create_conversation(
    db: AsyncSession,
    conversation_id: uuid.UUID | None,
    first_user_message: str,
) -> Conversation:
    if conversation_id:
        result = await db.execute(
            select(Conversation).where(Conversation.id == conversation_id)
        )
        conv = result.scalar_one_or_none()
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return conv

    title = first_user_message[:60] + ("…" if len(first_user_message) > 60 else "")
    conv = Conversation(id=uuid.uuid4(), title=title)
    db.add(conv)
    await db.flush()
    return conv


async def _augment_last_user_message(
    db: AsyncSession,
    messages: list[ChatMessage],
    use_rag: bool,
    use_web_search: bool,
) -> list[dict]:
    """Convert schema messages to dicts and optionally augment the last user turn."""
    raw: list[dict] = [m.model_dump() for m in messages]

    # Find the last user message to augment
    last_user_idx = next(
        (i for i in reversed(range(len(raw))) if raw[i]["role"] == "user"),
        None,
    )
    if last_user_idx is None:
        return raw

    original_text = raw[last_user_idx]["content"]

    if use_rag:
        chunks = await retrieve_context(db, original_text)
        if chunks:
            raw[last_user_idx]["content"] = build_rag_prompt(original_text, chunks)

    if use_web_search:
        try:
            search_resp = await web_search(original_text)
            context = format_search_context(search_resp)
            raw[last_user_idx]["content"] = (
                f"Web search results:\n{context}\n\nUser question: {original_text}"
            )
        except ValueError:
            pass  # Tavily not configured — silently skip

    return raw


async def _load_history(db: AsyncSession, conversation_id: uuid.UUID) -> list[dict]:
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
        .limit(40)
    )
    return [{"role": m.role, "content": m.content} for m in result.scalars()]


def _sse(data: str) -> str:
    """Wrap a string as an SSE data line."""
    return f"data: {data}\n\n"


# ── POST /api/chat/stream ─────────────────────────────────────────────────────

@router.post("/stream")
async def stream_chat_endpoint(
    request: StreamChatRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Stream tokens via Server-Sent Events.

    Each event is a JSON-encoded line:

        data: {"delta": "<token>"}

    The final event signals completion:

        data: {"done": true, "conversation_id": "<uuid>"}
    """
    last_user = next(
        (m.content for m in reversed(request.messages) if m.role == "user"),
        "",
    )
    conv = await _get_or_create_conversation(db, request.conversation_id, last_user)

    # Persist user turn
    db.add(
        Message(
            id=uuid.uuid4(),
            conversation_id=conv.id,
            role="user",
            content=last_user,
        )
    )
    await db.commit()

    # Build full message list: history + augmented new messages
    history = await _load_history(db, conv.id)
    raw_messages = await _augment_last_user_message(
        db, request.messages, request.use_rag, request.use_web_search
    )

    base_system = request.system_prompt or DEFAULT_SYSTEM_PROMPT
    resolved_system = base_system + (WEB_SEARCH_PROMPT_ADDON if request.use_web_search else "")
    provider = Provider(request.provider)
    model = request.model
    creds = _creds(http_request)

    async def token_generator() -> AsyncGenerator[str, None]:
        collected: list[str] = []
        try:
            async for item in stream_chat_with_tools(
                raw_messages,
                model=model,
                provider=provider,
                system_prompt=resolved_system,
                creds=creds,
                enable_web_search=request.use_web_search,
            ):
                if isinstance(item, dict):
                    yield _sse(json.dumps(item))
                else:
                    collected.append(item)
                    yield _sse(SSEToken(delta=item).model_dump_json())

            assistant_content = "".join(collected)
            db.add(
                Message(
                    id=uuid.uuid4(),
                    conversation_id=conv.id,
                    role="assistant",
                    content=assistant_content,
                )
            )
            await db.commit()
        except Exception as exc:
            # Surface errors to the client via SSE before closing
            yield _sse(json.dumps({"error": str(exc)}))
        finally:
            yield _sse(SSEDone(conversation_id=str(conv.id)).model_dump_json())

    return StreamingResponse(
        token_generator(),
        media_type="text/event-stream",
        headers={
            "X-Conversation-Id": str(conv.id),
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


# ── POST /api/chat/complete ───────────────────────────────────────────────────

@router.post("/complete", response_model=MessageOut)
async def complete_chat_endpoint(
    request: CompleteChatRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Non-streaming chat: waits for the full response before returning."""
    last_user = next(
        (m.content for m in reversed(request.messages) if m.role == "user"),
        "",
    )
    conv = await _get_or_create_conversation(db, request.conversation_id, last_user)

    db.add(
        Message(
            id=uuid.uuid4(),
            conversation_id=conv.id,
            role="user",
            content=last_user,
        )
    )
    await db.commit()

    raw_messages = await _augment_last_user_message(
        db, request.messages, request.use_rag, request.use_web_search
    )
    resolved_system = request.system_prompt or DEFAULT_SYSTEM_PROMPT

    tokens: list[str] = []
    async for token in stream_chat(
        raw_messages,
        model=request.model,
        provider=request.provider,
        system_prompt=resolved_system,
        creds=_creds(http_request),
    ):
        tokens.append(token)

    assistant_content = "".join(tokens)
    assistant_msg = Message(
        id=uuid.uuid4(),
        conversation_id=conv.id,
        role="assistant",
        content=assistant_content,
    )
    db.add(assistant_msg)
    await db.commit()
    await db.refresh(assistant_msg)

    return MessageOut.model_validate(assistant_msg)


# ── Legacy POST /api/chat (backward-compat) ───────────────────────────────────

@router.post("")
async def chat_legacy(request: ChatRequest, http_request: Request, db: AsyncSession = Depends(get_db)):
    """Backward-compatible single-message endpoint.

    Wraps the legacy ChatRequest into StreamChatRequest and delegates to
    stream_chat_endpoint or complete_chat_endpoint.
    """
    wrapped = StreamChatRequest(
        messages=[ChatMessage(role="user", content=request.message)],
        model=settings.ollama_model
        if settings.llm_provider == "ollama"
        else (settings.openai_model if settings.llm_provider == "openai" else settings.anthropic_model),
        provider=settings.llm_provider,
        conversation_id=request.conversation_id,
        use_rag=request.use_rag,
        use_web_search=request.use_web_search,
    )

    if request.stream:
        return await stream_chat_endpoint(wrapped, http_request, db)
    return await complete_chat_endpoint(
        CompleteChatRequest(**wrapped.model_dump()), http_request, db
    )


# ── GET /api/conversations ────────────────────────────────────────────────────

@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
    offset: int = 0,
):
    result = await db.execute(
        select(
            Conversation,
            func.count(Message.id).label("message_count"),
        )
        .outerjoin(Message, Message.conversation_id == Conversation.id)
        .group_by(Conversation.id)
        .order_by(Conversation.updated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return [
        ConversationOut(
            id=row.Conversation.id,
            title=row.Conversation.title,
            created_at=row.Conversation.created_at,
            updated_at=row.Conversation.updated_at,
            message_count=row.message_count,
        )
        for row in result.all()
    ]


# ── POST /api/conversations ───────────────────────────────────────────────────

@router.post("/conversations", response_model=ConversationDetailOut, status_code=201)
async def save_conversation(
    request: SaveConversationRequest,
    db: AsyncSession = Depends(get_db),
):
    """Persist a full conversation (e.g. imported from another session)."""
    conv = Conversation(id=uuid.uuid4(), title=request.title)
    db.add(conv)
    await db.flush()

    for msg in request.messages:
        db.add(
            Message(
                id=uuid.uuid4(),
                conversation_id=conv.id,
                role=msg.role,
                content=msg.content,
            )
        )

    await db.commit()

    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conv.id)
        .options(selectinload(Conversation.messages))
    )
    return result.scalar_one()


# ── GET /api/conversations/{id} ───────────────────────────────────────────────

@router.get("/conversations/{conversation_id}", response_model=ConversationDetailOut)
async def get_conversation(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conversation_id)
        .options(selectinload(Conversation.messages))
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


# ── DELETE /api/conversations/{id} ───────────────────────────────────────────

@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.delete(conv)
    await db.commit()
