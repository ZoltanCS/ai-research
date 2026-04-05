"""Unified AI provider service.

Supports five providers via a single stream_chat interface:
  - ollama    (local, fetches available models dynamically)
  - openai    (cloud, fetches live model list when key is present)
  - anthropic (cloud, fetches live model list when key is present)
  - cerebras  (cloud, fast inference, OpenAI-compatible)
  - vercel    (AI Gateway proxy, OpenAI-compatible)

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
from dataclasses import dataclass, field
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
    CEREBRAS = "cerebras"
    VERCEL = "vercel"


# ── Runtime credential overrides ──────────────────────────────────────────────

@dataclass
class ProviderCredentials:
    """Runtime credential overrides sourced from request headers."""
    openai_key: str = ""
    anthropic_key: str = ""
    cerebras_key: str = ""
    vercel_token: str = ""
    vercel_gateway_url: str = ""
    ollama_host: str = ""

    def get_openai(self) -> str:
        return self.openai_key or settings.openai_api_key

    def get_anthropic(self) -> str:
        return self.anthropic_key or settings.anthropic_api_key

    def get_cerebras(self) -> str:
        return self.cerebras_key or settings.cerebras_api_key

    def get_vercel(self) -> str:
        return self.vercel_token or settings.vercel_api_token

    def get_gateway_url(self) -> str:
        return self.vercel_gateway_url or settings.vercel_gateway_url

    def get_ollama(self) -> str:
        return self.ollama_host or settings.ollama_host

    @classmethod
    async def from_db(cls, db) -> "ProviderCredentials":
        """Load global settings from DB."""
        from sqlalchemy import select
        from models.database import GlobalSettings
        try:
            rows = await db.execute(select(GlobalSettings))
            data = {r.key: r.value for r in rows.scalars()}
            return cls(
                openai_key=data.get("openai_api_key", ""),
                anthropic_key=data.get("anthropic_api_key", ""),
                cerebras_key=data.get("cerebras_api_key", ""),
                vercel_token=data.get("vercel_api_token", ""),
                vercel_gateway_url=data.get("vercel_gateway_url", ""),
                ollama_host=data.get("ollama_host", ""),
            )
        except Exception:
            return cls()


# ── Model catalogue ───────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ModelInfo:
    id: str
    name: str
    provider: Provider
    context_length: int | None = None

# Static lists for cloud providers (used as fallbacks when no key is present)
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

_CEREBRAS_MODELS: list[ModelInfo] = [
    ModelInfo("llama-3.3-70b", "Llama 3.3 70B",  Provider.CEREBRAS, 128_000),
    ModelInfo("llama3.1-70b",  "Llama 3.1 70B",  Provider.CEREBRAS, 128_000),
    ModelInfo("llama3.1-8b",   "Llama 3.1 8B",   Provider.CEREBRAS, 128_000),
    ModelInfo("qwen-3-32b",    "Qwen 3 32B",     Provider.CEREBRAS,  32_000),
]

# Models available through Vercel AI Gateway (subset of popular cross-provider models).
# Prefix format is <provider-slug>/<model-id> as required by the gateway.
_VERCEL_MODELS: list[ModelInfo] = [
    ModelInfo("openai/gpt-4o",                          "GPT-4o",                Provider.VERCEL, 128_000),
    ModelInfo("openai/gpt-4o-mini",                     "GPT-4o Mini",           Provider.VERCEL, 128_000),
    ModelInfo("anthropic/claude-opus-4-5",              "Claude Opus 4.5",       Provider.VERCEL, 200_000),
    ModelInfo("anthropic/claude-sonnet-4-5",            "Claude Sonnet 4.5",     Provider.VERCEL, 200_000),
    ModelInfo("google/gemini-2.0-flash",                "Gemini 2.0 Flash",      Provider.VERCEL, 1_000_000),
    ModelInfo("google/gemini-1.5-pro",                  "Gemini 1.5 Pro",        Provider.VERCEL, 2_000_000),
    ModelInfo("meta-llama/llama-3.3-70b-instruct",      "Llama 3.3 70B",         Provider.VERCEL, 128_000),
    ModelInfo("deepseek/deepseek-r1",                   "DeepSeek R1",           Provider.VERCEL, 128_000),
]


# ── Model listing ─────────────────────────────────────────────────────────────

async def _list_ollama_models(creds: ProviderCredentials) -> list[ModelInfo]:
    """Fetch installed models from the local Ollama daemon."""
    host = creds.get_ollama()
    try:
        async with httpx.AsyncClient(base_url=host, timeout=5) as client:
            response = await client.get("/api/tags")
            response.raise_for_status()
            data = response.json()
            return [
                ModelInfo(id=m["name"], name=m["name"], provider=Provider.OLLAMA)
                for m in data.get("models", [])
            ]
    except Exception as exc:
        log.warning("Could not reach Ollama at %s: %s", host, exc)
        return []


async def _list_openai_models(creds: ProviderCredentials) -> list[ModelInfo]:
    """Fetch live model list from OpenAI; fall back to static list when no key."""
    key = creds.get_openai()
    if not key:
        return _OPENAI_MODELS
    try:
        client = openai.AsyncOpenAI(api_key=key)
        resp = await client.models.list()
        CHAT_PREFIXES = ("gpt-", "o1", "o3", "o4", "chatgpt")
        models = [
            m for m in resp.data
            if any(m.id.startswith(p) for p in CHAT_PREFIXES)
            and "realtime" not in m.id
            and "audio" not in m.id
        ]
        models.sort(key=lambda m: m.id, reverse=True)
        result = [ModelInfo(id=m.id, name=m.id, provider=Provider.OPENAI) for m in models]
        return result or _OPENAI_MODELS
    except Exception as exc:
        log.warning("Could not fetch OpenAI models: %s", exc)
        return _OPENAI_MODELS


async def _list_anthropic_models(creds: ProviderCredentials) -> list[ModelInfo]:
    """Fetch live model list from Anthropic; fall back to static list when no key."""
    key = creds.get_anthropic()
    if not key:
        return _ANTHROPIC_MODELS
    try:
        client = anthropic.AsyncAnthropic(api_key=key)
        resp = await client.models.list()
        result = [
            ModelInfo(
                id=m.id,
                name=getattr(m, "display_name", m.id),
                provider=Provider.ANTHROPIC,
                context_length=getattr(m, "context_window", None),
            )
            for m in resp.data
        ]
        return result or _ANTHROPIC_MODELS
    except Exception as exc:
        log.warning("Could not fetch Anthropic models: %s", exc)
        return _ANTHROPIC_MODELS


async def _list_cerebras_models(creds: ProviderCredentials) -> list[ModelInfo]:
    """Fetch live model list from Cerebras; fall back to static list when no key."""
    key = creds.get_cerebras()
    if not key:
        return _CEREBRAS_MODELS
    try:
        client = openai.AsyncOpenAI(api_key=key, base_url="https://api.cerebras.ai/v1")
        resp = await client.models.list()
        result = [ModelInfo(id=m.id, name=m.id, provider=Provider.CEREBRAS) for m in resp.data]
        return result or _CEREBRAS_MODELS
    except Exception as exc:
        log.warning("Could not fetch Cerebras models: %s", exc)
        return _CEREBRAS_MODELS


async def list_models(
    provider: Provider | str,
    creds: ProviderCredentials | None = None,
) -> list[ModelInfo]:
    """Return available models for the given provider."""
    if creds is None:
        creds = ProviderCredentials()
    match Provider(provider):
        case Provider.OPENAI:
            return await _list_openai_models(creds)
        case Provider.ANTHROPIC:
            return await _list_anthropic_models(creds)
        case Provider.CEREBRAS:
            return await _list_cerebras_models(creds)
        case Provider.VERCEL:
            return _VERCEL_MODELS
        case Provider.OLLAMA:
            return await _list_ollama_models(creds)


async def list_all_models(
    creds: ProviderCredentials | None = None,
) -> dict[str, list[ModelInfo]]:
    """Return models for all providers concurrently."""
    if creds is None:
        creds = ProviderCredentials()

    ollama_models, openai_models, anthropic_models, cerebras_models = (
        await asyncio.gather(
            _list_ollama_models(creds),
            _list_openai_models(creds),
            _list_anthropic_models(creds),
            _list_cerebras_models(creds),
        )
    )
    return {
        Provider.OLLAMA: ollama_models,
        Provider.OPENAI: openai_models,
        Provider.ANTHROPIC: anthropic_models,
        Provider.CEREBRAS: cerebras_models,
        Provider.VERCEL: _VERCEL_MODELS,
    }


# ── Provider health checks ────────────────────────────────────────────────────

async def _check_ollama(creds: ProviderCredentials) -> dict:
    host = creds.get_ollama()
    try:
        async with httpx.AsyncClient(base_url=host, timeout=3) as client:
            r = await client.get("/api/tags")
            r.raise_for_status()
            model_count = len(r.json().get("models", []))
            return {"status": "ok", "model_count": model_count, "host": host}
    except Exception as exc:
        return {"status": "error", "detail": str(exc), "host": host}


async def _check_openai(creds: ProviderCredentials) -> dict:
    key = creds.get_openai()
    if not key:
        return {"status": "unconfigured", "detail": "No OpenAI API key set"}
    try:
        client = openai.AsyncOpenAI(api_key=key)
        await client.models.list()
        return {"status": "ok"}
    except openai.AuthenticationError:
        return {"status": "error", "detail": "Invalid API key"}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}


async def _check_anthropic(creds: ProviderCredentials) -> dict:
    key = creds.get_anthropic()
    if not key:
        return {"status": "unconfigured", "detail": "No Anthropic API key set"}
    try:
        client = anthropic.AsyncAnthropic(api_key=key)
        await client.models.list()
        return {"status": "ok"}
    except anthropic.AuthenticationError:
        return {"status": "error", "detail": "Invalid API key"}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}


async def _check_cerebras(creds: ProviderCredentials) -> dict:
    key = creds.get_cerebras()
    if not key:
        return {"status": "unconfigured", "detail": "No Cerebras API key set"}
    try:
        client = openai.AsyncOpenAI(
            api_key=key,
            base_url="https://api.cerebras.ai/v1",
        )
        await client.models.list()
        return {"status": "ok"}
    except openai.AuthenticationError:
        return {"status": "error", "detail": "Invalid API key"}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}


async def _check_vercel(creds: ProviderCredentials) -> dict:
    token = creds.get_vercel()
    gateway_url = creds.get_gateway_url()
    if not token:
        return {"status": "unconfigured", "detail": "No Vercel API token set"}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{gateway_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
        return {"status": "ok", "host": gateway_url}
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            return {"status": "error", "detail": "Invalid Vercel API token"}
        return {"status": "error", "detail": str(e)}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}


async def get_provider_status(
    creds: ProviderCredentials | None = None,
) -> dict[str, dict]:
    """Run health checks for all providers concurrently."""
    if creds is None:
        creds = ProviderCredentials()
    ollama_status, openai_status, anthropic_status, cerebras_status, vercel_status = (
        await asyncio.gather(
            _check_ollama(creds),
            _check_openai(creds),
            _check_anthropic(creds),
            _check_cerebras(creds),
            _check_vercel(creds),
            return_exceptions=False,
        )
    )
    return {
        Provider.OLLAMA: ollama_status,
        Provider.OPENAI: openai_status,
        Provider.ANTHROPIC: anthropic_status,
        Provider.CEREBRAS: cerebras_status,
        Provider.VERCEL: vercel_status,
    }


# ── Per-provider streaming implementations ────────────────────────────────────

async def _stream_ollama(
    messages: list[dict],
    model: str,
    system_prompt: str | None,
    creds: ProviderCredentials,
) -> AsyncGenerator[str, None]:
    host = creds.get_ollama()
    full_messages = _prepend_system(messages, system_prompt)
    try:
        async with httpx.AsyncClient(base_url=host, timeout=120) as client:
            async with client.stream(
                "POST",
                "/api/chat",
                json={"model": model, "messages": full_messages, "stream": True},
            ) as response:
                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 404:
                        raise RuntimeError(
                            f"Model '{model}' not found in Ollama. "
                            f"Pull it first with: `ollama pull {model}`"
                        ) from None
                    raise
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
    except httpx.ConnectError:
        raise RuntimeError(
            f"Cannot connect to Ollama at {host}. "
            "Make sure Ollama is running (`ollama serve`) or switch to a cloud provider."
        ) from None


async def _stream_openai(
    messages: list[dict],
    model: str,
    system_prompt: str | None,
    creds: ProviderCredentials,
) -> AsyncGenerator[str, None]:
    full_messages = _prepend_system(messages, system_prompt)
    client = openai.AsyncOpenAI(api_key=creds.get_openai())
    stream = await client.chat.completions.create(
        model=model,
        messages=full_messages,  # type: ignore[arg-type]
        max_tokens=4096,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def _stream_anthropic(
    messages: list[dict],
    model: str,
    system_prompt: str | None,
    creds: ProviderCredentials,
) -> AsyncGenerator[str, None]:
    # Anthropic keeps system separate; strip any embedded system turn
    chat_messages = [m for m in messages if m["role"] != "system"]

    # Fall back to embedded system if explicit one not supplied
    embedded = next(
        (m["content"] for m in messages if m["role"] == "system"), None
    )
    resolved_system = system_prompt or embedded

    client = anthropic.AsyncAnthropic(api_key=creds.get_anthropic())
    kwargs: dict = {
        "model": model,
        "max_tokens": 4096,
        "messages": chat_messages,
    }
    if resolved_system:
        kwargs["system"] = resolved_system

    async with client.messages.stream(**kwargs) as stream:
        async for text in stream.text_stream:
            yield text


async def _stream_cerebras(
    messages: list[dict],
    model: str,
    system_prompt: str | None,
    creds: ProviderCredentials,
) -> AsyncGenerator[str, None]:
    full_messages = _prepend_system(messages, system_prompt)
    client = openai.AsyncOpenAI(
        api_key=creds.get_cerebras(),
        base_url="https://api.cerebras.ai/v1",
    )
    stream = await client.chat.completions.create(
        model=model,
        messages=full_messages,  # type: ignore[arg-type]
        max_tokens=8192,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def _stream_vercel(
    messages: list[dict],
    model: str,
    system_prompt: str | None,
    creds: ProviderCredentials,
) -> AsyncGenerator[str, None]:
    full_messages = _prepend_system(messages, system_prompt)
    client = openai.AsyncOpenAI(
        api_key=creds.get_vercel(),
        base_url=creds.get_gateway_url(),
    )
    stream = await client.chat.completions.create(
        model=model,
        messages=full_messages,  # type: ignore[arg-type]
        max_tokens=4096,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


# ── Tool definitions ──────────────────────────────────────────────────────────

WEB_SEARCH_TOOL_OPENAI = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the web for current information. Use this when you need up-to-date facts, news, or information you're not certain about.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query",
                }
            },
            "required": ["query"],
        },
    },
}

WEB_SEARCH_TOOL_ANTHROPIC = {
    "name": "web_search",
    "description": "Search the web for current information. Use this when you need up-to-date facts, news, or information you're not certain about.",
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query",
            }
        },
        "required": ["query"],
    },
}


# ── Public interface ──────────────────────────────────────────────────────────

async def stream_chat(
    messages: list[dict],
    model: str,
    provider: Provider | str,
    system_prompt: str | None = None,
    creds: ProviderCredentials | None = None,
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
        One of ``"ollama"``, ``"openai"``, ``"anthropic"``, ``"cerebras"``, ``"vercel"``.
    system_prompt:
        Optional explicit system prompt. Takes precedence over any system turn
        embedded in *messages*.
    creds:
        Optional runtime credential overrides. Falls back to env vars when absent.
    """
    if creds is None:
        creds = ProviderCredentials()

    match Provider(provider):
        case Provider.OPENAI:
            gen = _stream_openai(messages, model, system_prompt, creds)
        case Provider.ANTHROPIC:
            gen = _stream_anthropic(messages, model, system_prompt, creds)
        case Provider.CEREBRAS:
            gen = _stream_cerebras(messages, model, system_prompt, creds)
        case Provider.VERCEL:
            gen = _stream_vercel(messages, model, system_prompt, creds)
        case Provider.OLLAMA:
            gen = _stream_ollama(messages, model, system_prompt, creds)
        case _:
            raise ValueError(f"Unknown provider: {provider!r}")

    async for token in gen:
        yield token


async def stream_chat_with_tools(
    messages: list[dict],
    model: str,
    provider: Provider | str,
    system_prompt: str | None = None,
    creds: ProviderCredentials | None = None,
    enable_web_search: bool = False,
) -> AsyncGenerator[str | dict, None]:
    """Stream tokens, optionally with LLM-driven web search tool calling.

    Yields:
      - ``dict`` for tool events: ``{"tool_call": "web_search", "query": "..."}``
        and ``{"tool_result": True, "count": N}``
      - ``str`` for text tokens

    When ``enable_web_search=False`` (or provider is Ollama), delegates directly
    to ``stream_chat``.
    """
    if creds is None:
        creds = ProviderCredentials()

    p = Provider(provider)

    # Ollama doesn't reliably support tool calling — fall back to plain streaming
    if not enable_web_search or p == Provider.OLLAMA:
        async for token in stream_chat(messages, model, p, system_prompt, creds):
            yield token
        return

    if p == Provider.ANTHROPIC:
        async for item in _stream_with_tools_anthropic(
            messages, model, system_prompt, creds
        ):
            yield item
        return

    # OpenAI-compatible providers: OpenAI, Cerebras, Vercel
    if p == Provider.OPENAI:
        client = openai.AsyncOpenAI(api_key=creds.get_openai())
    elif p == Provider.CEREBRAS:
        client = openai.AsyncOpenAI(
            api_key=creds.get_cerebras(),
            base_url="https://api.cerebras.ai/v1",
        )
    elif p == Provider.VERCEL:
        client = openai.AsyncOpenAI(
            api_key=creds.get_vercel(),
            base_url=creds.get_gateway_url(),
        )
    else:
        # Unexpected — fall back
        async for token in stream_chat(messages, model, p, system_prompt, creds):
            yield token
        return

    full_messages = _prepend_system(messages, system_prompt)

    # First call — non-streaming to detect tool use
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=full_messages,  # type: ignore[arg-type]
            tools=[WEB_SEARCH_TOOL_OPENAI],  # type: ignore[arg-type]
            tool_choice="auto",
            max_tokens=4096,
        )
        choice = response.choices[0]
    except Exception as exc:
        log.warning("Tool calling not supported by %s/%s, falling back: %s", p, model, exc)
        async for token in stream_chat(messages, model, p, system_prompt, creds):
            yield token
        return

    if choice.finish_reason == "tool_calls":
        tool_calls = choice.message.tool_calls or []

        # Reconstruct assistant message with tool_calls for the history
        messages_with_tools: list[dict] = list(full_messages) + [
            {
                "role": "assistant",
                "content": choice.message.content,
                "tool_calls": [tc.model_dump() for tc in tool_calls],
            }
        ]

        for tc in tool_calls:
            if tc.function.name == "web_search":
                args = json.loads(tc.function.arguments)
                query = args["query"]
                yield {"tool_call": "web_search", "query": query}

                try:
                    from services.web_search import search as web_search_fn
                    result = await web_search_fn(query, max_results=5, include_content=False)
                    results_text = "\n\n".join(
                        f"[{i + 1}] {r.title}\n{r.url}\n{r.snippet}"
                        for i, r in enumerate(result.results[:5])
                    )
                    yield {"tool_result": True, "count": len(result.results)}
                except Exception as exc:
                    results_text = f"Search failed: {exc}"
                    yield {"tool_result": True, "count": 0}

                messages_with_tools.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": results_text,
                    }
                )

        # Second call — stream the final answer
        stream = await client.chat.completions.create(
            model=model,
            messages=messages_with_tools,  # type: ignore[arg-type]
            max_tokens=4096,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    else:
        # No tool call — yield existing content as tokens
        content = choice.message.content or ""
        for char in content:
            yield char


async def _stream_with_tools_anthropic(
    messages: list[dict],
    model: str,
    system_prompt: str | None,
    creds: ProviderCredentials,
) -> AsyncGenerator[str | dict, None]:
    """Tool-calling loop for Anthropic provider."""
    chat_messages = [m for m in messages if m["role"] != "system"]
    embedded = next(
        (m["content"] for m in messages if m["role"] == "system"), None
    )
    resolved_system = system_prompt or embedded

    client = anthropic.AsyncAnthropic(api_key=creds.get_anthropic())
    kwargs: dict = {
        "model": model,
        "max_tokens": 4096,
        "messages": chat_messages,
        "tools": [WEB_SEARCH_TOOL_ANTHROPIC],
    }
    if resolved_system:
        kwargs["system"] = resolved_system

    response = await client.messages.create(**kwargs)

    # Check for tool use blocks
    tool_use_blocks = [b for b in response.content if b.type == "tool_use"]

    if response.stop_reason == "tool_use" and tool_use_blocks:
        # Build updated message history with the assistant's tool_use turn
        updated_messages = list(chat_messages) + [
            {"role": "assistant", "content": response.content}
        ]

        tool_results = []
        for block in tool_use_blocks:
            if block.name == "web_search":
                query = block.input.get("query", "")
                yield {"tool_call": "web_search", "query": query}

                try:
                    from services.web_search import search as web_search_fn
                    result = await web_search_fn(query, max_results=5, include_content=False)
                    results_text = "\n\n".join(
                        f"[{i + 1}] {r.title}\n{r.url}\n{r.snippet}"
                        for i, r in enumerate(result.results[:5])
                    )
                    yield {"tool_result": True, "count": len(result.results)}
                except Exception as exc:
                    results_text = f"Search failed: {exc}"
                    yield {"tool_result": True, "count": 0}

                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": results_text,
                    }
                )

        updated_messages.append({"role": "user", "content": tool_results})

        # Stream the final response
        final_kwargs: dict = {
            "model": model,
            "max_tokens": 4096,
            "messages": updated_messages,
        }
        if resolved_system:
            final_kwargs["system"] = resolved_system

        async with client.messages.stream(**final_kwargs) as stream:
            async for text in stream.text_stream:
                yield text
    else:
        # No tool use — yield text content from the response
        for block in response.content:
            if hasattr(block, "text"):
                yield block.text


async def complete_chat(
    messages: list[dict],
    model: str,
    provider: Provider | str,
    system_prompt: str | None = None,
    creds: ProviderCredentials | None = None,
) -> str:
    """Non-streaming variant: collect all tokens and return the full response."""
    tokens: list[str] = []
    async for token in stream_chat(messages, model, provider, system_prompt, creds):
        tokens.append(token)
    return "".join(tokens)


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
