"""LLM provider abstraction supporting Ollama, OpenAI, and Anthropic."""

from collections.abc import AsyncGenerator

import anthropic
import httpx
import openai

from core.config import settings


async def stream_ollama(
    messages: list[dict],
    model: str | None = None,
) -> AsyncGenerator[str, None]:
    model = model or settings.ollama_model
    async with httpx.AsyncClient(base_url=settings.ollama_host, timeout=120) as client:
        async with client.stream(
            "POST",
            "/api/chat",
            json={"model": model, "messages": messages, "stream": True},
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line:
                    import json
                    data = json.loads(line)
                    if content := data.get("message", {}).get("content"):
                        yield content
                    if data.get("done"):
                        break


async def stream_openai(
    messages: list[dict],
    model: str | None = None,
) -> AsyncGenerator[str, None]:
    model = model or settings.openai_model
    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    async with client.chat.completions.stream(
        model=model,
        messages=messages,
        max_tokens=4096,
    ) as stream:
        async for event in stream:
            if event.choices and event.choices[0].delta.content:
                yield event.choices[0].delta.content


async def stream_anthropic(
    messages: list[dict],
    model: str | None = None,
) -> AsyncGenerator[str, None]:
    model = model or settings.anthropic_model
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    # Separate system message from conversation messages
    system = None
    chat_messages = []
    for msg in messages:
        if msg["role"] == "system":
            system = msg["content"]
        else:
            chat_messages.append(msg)

    kwargs: dict = {
        "model": model,
        "max_tokens": 4096,
        "messages": chat_messages,
        "thinking": {"type": "adaptive"},
    }
    if system:
        kwargs["system"] = system

    async with client.messages.stream(**kwargs) as stream:
        async for text in stream.text_stream:
            yield text


async def stream_llm(
    messages: list[dict],
    provider: str | None = None,
) -> AsyncGenerator[str, None]:
    """Route to the configured LLM provider and stream tokens."""
    provider = provider or settings.llm_provider

    if provider == "openai":
        async for token in stream_openai(messages):
            yield token
    elif provider == "anthropic":
        async for token in stream_anthropic(messages):
            yield token
    else:
        async for token in stream_ollama(messages):
            yield token


async def get_embedding(text: str) -> list[float]:
    """Get an embedding vector via Ollama."""
    async with httpx.AsyncClient(base_url=settings.ollama_host, timeout=30) as client:
        response = await client.post(
            "/api/embeddings",
            json={"model": settings.embedding_model, "prompt": text},
        )
        response.raise_for_status()
        return response.json()["embedding"]
