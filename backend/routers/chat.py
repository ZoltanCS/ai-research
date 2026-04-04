"""Chat API endpoints with streaming support."""

import uuid
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from models.database import Conversation, Message
from models.schemas import (
    ChatRequest,
    ConversationDetailOut,
    ConversationOut,
    MessageOut,
)
from services.llm import stream_llm
from services.rag import build_rag_prompt, retrieve_context
from services.search import format_search_context, web_search

router = APIRouter()

SYSTEM_PROMPT = (
    "You are LocalMind, a helpful AI research assistant. "
    "Answer concisely and accurately. When referencing sources, cite them."
)


async def _build_messages(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    user_message: str,
    use_rag: bool,
    use_web_search: bool,
) -> list[dict]:
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Load conversation history
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
        .limit(20)
    )
    for msg in result.scalars():
        messages.append({"role": msg.role, "content": msg.content})

    # Augment user message with context
    augmented = user_message

    if use_rag:
        chunks = await retrieve_context(db, user_message)
        if chunks:
            augmented = build_rag_prompt(user_message, chunks)

    if use_web_search:
        try:
            search_resp = await web_search(user_message)
            context = format_search_context(search_resp)
            augmented = (
                f"Web search results:\n{context}\n\nUser question: {user_message}"
            )
        except ValueError:
            pass  # Tavily not configured, skip

    messages.append({"role": "user", "content": augmented})
    return messages


@router.post("")
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    # Get or create conversation
    if request.conversation_id:
        result = await db.execute(
            select(Conversation).where(Conversation.id == request.conversation_id)
        )
        conversation = result.scalar_one_or_none()
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conversation = Conversation(
            id=uuid.uuid4(),
            title=request.message[:60] + ("…" if len(request.message) > 60 else ""),
        )
        db.add(conversation)
        await db.flush()

    # Save user message
    user_msg = Message(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        role="user",
        content=request.message,
    )
    db.add(user_msg)
    await db.commit()

    messages = await _build_messages(
        db,
        conversation.id,
        request.message,
        request.use_rag,
        request.use_web_search,
    )

    if request.stream:
        async def token_stream() -> AsyncGenerator[str, None]:
            full_response = []
            async for token in stream_llm(messages):
                full_response.append(token)
                yield f"data: {token}\n\n"

            # Persist assistant response after stream completes
            assistant_content = "".join(full_response)
            async with db.begin():
                db.add(
                    Message(
                        id=uuid.uuid4(),
                        conversation_id=conversation.id,
                        role="assistant",
                        content=assistant_content,
                    )
                )
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            token_stream(),
            media_type="text/event-stream",
            headers={
                "X-Conversation-Id": str(conversation.id),
                "Cache-Control": "no-cache",
            },
        )

    # Non-streaming fallback
    tokens = []
    async for token in stream_llm(messages):
        tokens.append(token)

    assistant_content = "".join(tokens)
    assistant_msg = Message(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        role="assistant",
        content=assistant_content,
    )
    db.add(assistant_msg)
    await db.commit()

    return MessageOut(
        id=assistant_msg.id,
        role="assistant",
        content=assistant_content,
        created_at=assistant_msg.created_at,
    )


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
    rows = result.all()
    return [
        ConversationOut(
            id=row.Conversation.id,
            title=row.Conversation.title,
            created_at=row.Conversation.created_at,
            updated_at=row.Conversation.updated_at,
            message_count=row.message_count,
        )
        for row in rows
    ]


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
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.delete(conversation)
    await db.commit()
