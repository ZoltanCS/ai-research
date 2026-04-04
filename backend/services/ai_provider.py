"""Unified AI provider service.

Supports three providers via a single stream_chat interface:
  - ollama   (local, fetches available models dynamically)
  - openai   (cloud, static model list)
  - anthropic (cloud, static model list)

Usage
-----
    async for token in stream_chat(messages, model="llama3.2", provider="ollama"):
        print(token, end="", flush=True)
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

import anthropic
import httpx
import openai

from core.config import settings

log = logging.getLogger(__name__)


# ── Provider enum ─────────────────────────────────────────────────────────────

class Provider(StrEnum):
    OLLAMA = "ollama"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


# ── Model catalogue ───────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ModelInfo:
    id: str
    name: str
    provider: Provider
    context_length: int | None = None

# Static lists for cloud providers
_OPENAI_MODELS: list[ModelInfo] = [
    ModelInfo("gpt-4o",       "GPT-4o",       Provider.OPENAI, 128_000),
    ModelInfo("gpt-4o-mini",  "GPT-4o Mini",  Provider.OPENAI, 128_000),
    ModelInfo("gpt-3.5-turbo","GPT-3.5 Turbo",Provider.OPENAI,  16_385),
]

_ANTHROPIC_MODELS: list[ModelInfo] = [
    ModelInfo("claude-opus-4-5",   "Claude Opus 4.5",   Provider.ANTHROPIC, 200_000),
    ModelInfo("claude-sonnet-4-5", "Claude Sonnet 4.5", Provider.ANTHROPIC, 200_000),
    ModelInfo("claude-haiku-4-5",  "Claude Haiku 4.5",  Provider.ANTHROPIC, 200_000),
]


# ── Model listing ─────────────────────────────────────────────────────────────

async def _list_ollama_models() -> list[ModelInfo]:
    """Fetch installed models from the local Ollama daemon."""
    try:
        async with httpx.AsyncClient(
            base_url=settings.ollama_host, timeout=5
        ) as client:
            response = await client.get("/api/tags")
            response.raise_for_status()
            data = response.json()
            return [
                ModelInfo(
                    id=m["name"],
                    name=m["name"],
                    provider=Provider.OLLAMA,
                    context_length=None,
                )
                for m in data.get("models", [])
            ]
    except Exception as exc:
        log.warning("Could not reach Ollama at %s: %s", settings.ollama_host, exc)
        return []


async def list_models(provider: Provider | str) -> list[ModelInfo]:
    """Return available models for the given provider."""
    match Provider(provider):
        case Provider.OPENAI:
            return _OPENAI_MODELS
        case Provider.ANTHROPIC:
            return _ANTHROPIC_MODELS
        case Provider.OLLAMA:
            return await _list_ollama_models()


async def _static(value):
    """Trivial coroutine that immediately returns a static value."""
    return value


async def list_all_models() -> dict[str, list[ModelInfo]]:
    """Return models for all providers concurrently.

    Ollama is fetched live; OpenAI and Anthropic lists are static but
    gathered in the same call so the caller always gets a uniform dict.
    """
    ollama_models, openai_models, anthropic_models = await asyncio.gather(
        _list_ollama_models(),
        _static(_OPENAI_MODELS),
        _static(_ANTHROPIC_MODELS),
    )
    return {
        Provider.OLLAMA: ollama_models,
        Provider.OPENAI: openai_models,
        Provider.ANTHROPIC: anthropic_models,
    }


# ── Provider health checks ────────────────────────────────────────────────────

async def _check_ollama() -> dict:
    try:
        async with httpx.AsyncClient(
            base_url=settings.ollama_host, timeout=3
        ) as client:
            r = await client.get("/api/tags")
            r.raise_for_status()
            model_count = len(r.json().get("models", []))
            return {"status": "ok", "model_count": model_count, "host": settings.ollama_host}
    except Exception as exc:
        return {"status": "error", "detail": str(exc), "host": settings.ollama_host}


async def _check_openai() -> dict:
    if not settings.openai_api_key:
        return {"status": "unconfigured", "detail": "OPENAI_API_KEY not set"}
    try:
        client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
        await client.models.list()
        return {"status": "ok"}
    except openai.AuthenticationError:
        return {"status": "error", "detail": "Invalid API key"}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}


async def _check_anthropic() -> dict:
    if not settings.anthropic_api_key:
        return {"status": "unconfigured", "detail": "ANTHROPIC_API_KEY not set"}
    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        await client.models.list()
        return {"status": "ok"}
    except anthropic.AuthenticationError:
        return {"status": "error", "detail": "Invalid API key"}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}


async def get_provider_status() -> dict[str, dict]:
    """Run health checks for all three providers concurrently."""
    ollama_status, openai_status, anthropic_status = await asyncio.gather(
        _check_ollama(),
        _check_openai(),
        _check_anthropic(),
        return_exceptions=False,
    )
    return {
        Provider.OLLAMA: ollama_status,
        Provider.OPENAI: openai_status,
        Provider.ANTHROPIC: anthropic_status,
    }


# ── Per-provider streaming implementations ────────────────────────────────────

async def _stream_ollama(
    messages: list[dict],
    model: str,
    system_prompt: str | None,
) -> AsyncGenerator[str, None]:
    full_messages = _prepend_system(messages, system_prompt)
    async with httpx.AsyncClient(base_url=settings.ollama_host, timeout=120) as client:
        async with client.stream(
            "POST",
            "/api/chat",
            json={"model": model, "messages": full_messages, "stream": True},
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if content := data.get("message", {}).get("content"):
                    yield content
                if data.get("done"):
                    break


async def _stream_openai(
    messages: list[dict],
    model: str,
    system_prompt: str | None,
) -> AsyncGenerator[str, None]:
    full_messages = _prepend_system(messages, system_prompt)
    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    async with client.chat.completions.stream(
        model=model,
        messages=full_messages,  # type: ignore[arg-type]
        max_tokens=4096,
    ) as stream:
        async for event in stream:
            if event.choices and event.choices[0].delta.content:
                yield event.choices[0].delta.content


async def _stream_anthropic(
    messages: list[dict],
    model: str,
    system_prompt: str | None,
) -> AsyncGenerator[str, None]:
    # Anthropic keeps system separate; strip any embedded system turn
    chat_messages = [m for m in messages if m["role"] != "system"]

    # Fall back to embedded system if explicit one not supplied
    embedded = next(
        (m["content"] for m in messages if m["role"] == "system"), None
    )
    resolved_system = system_prompt or embedded

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    kwargs: dict = {
        "model": model,
        "max_tokens": 4096,
        "messages": chat_messages,
        "thinking": {"type": "adaptive"},
    }
    if resolved_system:
        kwargs["system"] = resolved_system

    async with client.messages.stream(**kwargs) as stream:
        async for text in stream.text_stream:
            yield text


# ── Public interface ──────────────────────────────────────────────────────────

async def stream_chat(
    messages: list[dict],
    model: str,
    provider: Provider | str,
    system_prompt: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream tokens from the chosen provider.

    Parameters
    ----------
    messages:
        OpenAI-style message list ``[{"role": "user"|"assistant", "content": "..."}]``.
        May include a ``system`` role entry; providers handle it correctly.
    model:
        Provider-specific model identifier.
    provider:
        One of ``"ollama"``, ``"openai"``, or ``"anthropic"``.
    system_prompt:
        Optional explicit system prompt. Takes precedence over any system turn
        embedded in *messages*.
    """
    match Provider(provider):
        case Provider.OPENAI:
            gen = _stream_openai(messages, model, system_prompt)
        case Provider.ANTHROPIC:
            gen = _stream_anthropic(messages, model, system_prompt)
        case Provider.OLLAMA:
            gen = _stream_ollama(messages, model, system_prompt)
        case _:
            raise ValueError(f"Unknown provider: {provider!r}")

    async for token in gen:
        yield token


# ── Helpers ───────────────────────────────────────────────────────────────────

def _prepend_system(
    messages: list[dict], system_prompt: str | None
) -> list[dict]:
    """Return a new message list with an injected system turn if needed."""
    if not system_prompt:
        return messages
    # Replace any existing system turn rather than duplicating it
    filtered = [m for m in messages if m["role"] != "system"]
    return [{"role": "system", "content": system_prompt}, *filtered]
