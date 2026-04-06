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
    tavily_key: str = ""
    exa_key: str = ""

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

    def get_tavily(self) -> str:
        return self.tavily_key or settings.tavily_api_key

    def get_exa(self) -> str:
        return self.exa_key or settings.exa_api_key

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
                tavily_key=data.get("tavily_api_key", ""),
                exa_key=data.get("exa_api_key", ""),
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


async def _stream_with_tools_openai_compat(
    messages: list[dict],
    model: str,
    system_prompt: str | None,
    creds: ProviderCredentials,
    client: openai.AsyncOpenAI,
) -> AsyncGenerator[str | dict, None]:
    """Streaming tool-calling for OpenAI-compatible providers (OpenAI, Cerebras, Vercel).

    Uses a single streaming call that detects tool use mid-stream — zero extra
    latency when the model decides not to call a tool.
    """
    full_messages = _prepend_system(messages, system_prompt)

    # Streaming call WITH tools — zero extra latency when no tool is called
    stream = await client.chat.completions.create(
        model=model,
        messages=full_messages,  # type: ignore[arg-type]
        tools=[WEB_SEARCH_TOOL_OPENAI],  # type: ignore[arg-type]
        tool_choice="auto",
        max_tokens=4096,
        stream=True,
    )

    # Accumulate tool call fragments and text
    tool_calls_acc: dict[int, dict] = {}
    content_tokens: list[str] = []
    finish_reason = None

    async for chunk in stream:
        if not chunk.choices:
            continue
        choice = chunk.choices[0]
        if choice.finish_reason:
            finish_reason = choice.finish_reason
        delta = choice.delta

        # Stream text tokens immediately
        if delta.content:
            content_tokens.append(delta.content)
            yield delta.content

        # Accumulate tool call fragments
        if delta.tool_calls:
            for tc_delta in delta.tool_calls:
                idx = tc_delta.index
                if idx not in tool_calls_acc:
                    tool_calls_acc[idx] = {"id": "", "name": "", "arguments": ""}
                if tc_delta.id:
                    tool_calls_acc[idx]["id"] += tc_delta.id
                if tc_delta.function:
                    if tc_delta.function.name:
                        tool_calls_acc[idx]["name"] += tc_delta.function.name
                    if tc_delta.function.arguments:
                        tool_calls_acc[idx]["arguments"] += tc_delta.function.arguments

    if finish_reason != "tool_calls" or not tool_calls_acc:
        return  # Normal completion, already streamed

    # Build messages with tool calls for the second call
    messages_with_tools: list[dict] = list(full_messages) + [
        {
            "role": "assistant",
            "content": "".join(content_tokens) or None,
            "tool_calls": [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": tc["arguments"]},
                }
                for tc in tool_calls_acc.values()
            ],
        }
    ]

    # Execute each tool call
    for tc in tool_calls_acc.values():
        if tc["name"] == "web_search":
            try:
                import json as _json
                query = _json.loads(tc["arguments"]).get("query", "")
            except Exception:
                continue

            yield {"tool_call": "web_search", "query": query}

            try:
                from services.web_search import search as _web_search
                result = await _web_search(
                    query, max_results=10, include_content=False,
                    exa_key=creds.get_exa(), tavily_key=creds.get_tavily(),
                )
                results_text = "\n\n".join(
                    f"[{i+1}] {r.title}\n{r.url}\n{r.snippet}"
                    for i, r in enumerate(result.results[:10])
                )
                yield {"tool_result": True, "count": len(result.results)}
            except Exception as exc:
                results_text = f"Search failed: {exc}"
                yield {"tool_result": True, "count": 0}

            messages_with_tools.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": results_text,
            })

    # Stream final response after tool execution
    final_stream = await client.chat.completions.create(
        model=model,
        messages=messages_with_tools,  # type: ignore[arg-type]
        max_tokens=4096,
        stream=True,
    )
    async for chunk in final_stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def _stream_with_tools_anthropic(
    messages: list[dict],
    model: str,
    system_prompt: str | None,
    creds: ProviderCredentials,
) -> AsyncGenerator[str | dict, None]:
    """Streaming tool-calling loop for Anthropic provider."""
    chat_messages = [m for m in messages if m["role"] != "system"]
    embedded = next(
        (m["content"] for m in messages if m["role"] == "system"), None
    )
    resolved_system = system_prompt or embedded

    client = anthropic.AsyncAnthropic(api_key=creds.get_anthropic())

    # Accumulate tool use blocks and text via streaming
    tool_use_blocks_acc: dict[int, dict] = {}
    content_tokens: list[str] = []
    stop_reason = None

    stream_kwargs: dict = {
        "model": model,
        "max_tokens": 4096,
        "messages": chat_messages,
        "tools": [WEB_SEARCH_TOOL_ANTHROPIC],
    }
    if resolved_system:
        stream_kwargs["system"] = resolved_system

    async with client.messages.stream(**stream_kwargs) as stream:
        async for event in stream:
            event_type = getattr(event, "type", None)

            if event_type == "content_block_start":
                block = getattr(event, "content_block", None)
                if block and getattr(block, "type", None) == "tool_use":
                    idx = getattr(event, "index", 0)
                    tool_use_blocks_acc[idx] = {
                        "id": getattr(block, "id", ""),
                        "name": getattr(block, "name", ""),
                        "input_str": "",
                    }

            elif event_type == "content_block_delta":
                delta = getattr(event, "delta", None)
                if delta:
                    delta_type = getattr(delta, "type", None)
                    if delta_type == "text_delta":
                        text = getattr(delta, "text", "")
                        if text:
                            content_tokens.append(text)
                            yield text
                    elif delta_type == "input_json_delta":
                        idx = getattr(event, "index", 0)
                        partial = getattr(delta, "partial_json", "")
                        if idx in tool_use_blocks_acc and partial:
                            tool_use_blocks_acc[idx]["input_str"] += partial

            elif event_type == "message_delta":
                delta = getattr(event, "delta", None)
                if delta:
                    stop_reason = getattr(delta, "stop_reason", stop_reason)

    if stop_reason != "tool_use" or not tool_use_blocks_acc:
        return  # Normal completion, already streamed

    # Reconstruct tool use blocks for history
    reconstructed_content: list[dict] = []
    if content_tokens:
        reconstructed_content.append({"type": "text", "text": "".join(content_tokens)})
    for tb in tool_use_blocks_acc.values():
        try:
            input_data = json.loads(tb["input_str"]) if tb["input_str"] else {}
        except Exception:
            input_data = {}
        reconstructed_content.append({
            "type": "tool_use",
            "id": tb["id"],
            "name": tb["name"],
            "input": input_data,
        })

    updated_messages: list[dict] = list(chat_messages) + [
        {"role": "assistant", "content": reconstructed_content}
    ]

    tool_results = []
    for tb in tool_use_blocks_acc.values():
        if tb["name"] == "web_search":
            try:
                input_data = json.loads(tb["input_str"]) if tb["input_str"] else {}
            except Exception:
                input_data = {}
            query = input_data.get("query", "")
            yield {"tool_call": "web_search", "query": query}

            try:
                from services.web_search import search as web_search_fn
                result = await web_search_fn(
                    query, max_results=10, include_content=False,
                    exa_key=creds.get_exa(), tavily_key=creds.get_tavily(),
                )
                results_text = "\n\n".join(
                    f"[{i + 1}] {r.title}\n{r.url}\n{r.snippet}"
                    for i, r in enumerate(result.results[:10])
                )
                yield {"tool_result": True, "count": len(result.results)}
            except Exception as exc:
                results_text = f"Search failed: {exc}"
                yield {"tool_result": True, "count": 0}

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tb["id"],
                "content": results_text,
            })

    updated_messages.append({"role": "user", "content": tool_results})

    # Stream the final response
    final_kwargs: dict = {
        "model": model,
        "max_tokens": 4096,
        "messages": updated_messages,
    }
    if resolved_system:
        final_kwargs["system"] = resolved_system

    async with client.messages.stream(**final_kwargs) as final_stream:
        async for text in final_stream.text_stream:
            yield text


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

    When ``enable_web_search=False``, delegates directly to ``stream_chat``.
    Ollama does not support tool calling and always uses plain streaming.
    """
    if creds is None:
        creds = ProviderCredentials()

    p = Provider(provider)

    # When web search is disabled, use plain streaming
    if not enable_web_search:
        async for token in stream_chat(messages, model, p, system_prompt, creds):
            yield token
        return

    # Ollama doesn't reliably support tool calling — fall back to plain streaming
    if p == Provider.OLLAMA:
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
        # Unexpected provider — fall back to plain streaming
        async for token in stream_chat(messages, model, p, system_prompt, creds):
            yield token
        return

    try:
        async for item in _stream_with_tools_openai_compat(
            messages, model, system_prompt, creds, client
        ):
            yield item
    except Exception as exc:
        log.warning("Tool calling not supported by %s/%s, falling back: %s", p, model, exc)
        async for token in stream_chat(messages, model, p, system_prompt, creds):
            yield token


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


# ── File tool definitions ─────────────────────────────────────────────────────

FILE_TOOLS_OPENAI = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List all files in the workspace. Returns a tree of files and directories.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a file from the workspace.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Relative path to the file"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create or overwrite a file in the workspace with the given content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path to the file"},
                    "content": {"type": "string", "description": "File content to write"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Delete a file or directory from the workspace.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Relative path to delete"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rename_file",
            "description": "Rename or move a file within the workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "old_path": {"type": "string"},
                    "new_path": {"type": "string"},
                },
                "required": ["old_path", "new_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "execute_code",
            "description": "Execute code in the workspace. Returns stdout, stderr, and exit code.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Code to execute"},
                    "language": {
                        "type": "string",
                        "enum": ["python", "javascript", "bash"],
                        "description": "Programming language",
                    },
                },
                "required": ["code", "language"],
            },
        },
    },
]

FILE_TOOLS_ANTHROPIC = [
    {
        "name": "list_files",
        "description": "List all files in the workspace.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "read_file",
        "description": "Read the contents of a file from the workspace.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Relative path to the file"}},
            "required": ["path"],
        },
    },
    {
        "name": "write_file",
        "description": "Create or overwrite a file in the workspace with the given content.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "delete_file",
        "description": "Delete a file or directory from the workspace.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "rename_file",
        "description": "Rename or move a file within the workspace.",
        "input_schema": {
            "type": "object",
            "properties": {"old_path": {"type": "string"}, "new_path": {"type": "string"}},
            "required": ["old_path", "new_path"],
        },
    },
    {
        "name": "execute_code",
        "description": "Execute code in the workspace.",
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {"type": "string"},
                "language": {"type": "string", "enum": ["python", "javascript", "bash"]},
            },
            "required": ["code", "language"],
        },
    },
]


async def _execute_file_tool(name: str, args: dict, workspace_root: "Path") -> str:
    """Execute a file-system or code-execution tool and return a string result."""
    from pathlib import Path as _Path

    def safe(rel: str) -> _Path:
        clean = _Path(rel).as_posix().lstrip("/")
        resolved = (workspace_root / clean).resolve()
        if not str(resolved).startswith(str(workspace_root.resolve())):
            raise ValueError("Path escapes workspace")
        return resolved

    if name == "list_files":
        def walk(p: _Path) -> dict:
            if p.is_dir():
                return {
                    "type": "dir",
                    "name": p.name,
                    "children": sorted(
                        [walk(c) for c in p.iterdir()],
                        key=lambda x: (x["type"] == "file", x["name"]),
                    ),
                }
            return {"type": "file", "name": p.name, "size": p.stat().st_size}
        tree = walk(workspace_root)
        return json.dumps(tree.get("children", []), indent=2)

    elif name == "read_file":
        p = safe(args.get("path", ""))
        if not p.exists():
            return f"Error: File not found: {args.get('path')}"
        return p.read_text(encoding="utf-8", errors="replace")

    elif name == "write_file":
        p = safe(args.get("path", ""))
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(args.get("content", ""), encoding="utf-8")
        return f"Written {p.stat().st_size} bytes to {args.get('path')}"

    elif name == "delete_file":
        import shutil as _shutil
        p = safe(args.get("path", ""))
        if not p.exists():
            return f"Error: Not found: {args.get('path')}"
        if p.is_dir():
            _shutil.rmtree(p)
        else:
            p.unlink()
        return f"Deleted {args.get('path')}"

    elif name == "rename_file":
        src = safe(args.get("old_path", ""))
        dst = safe(args.get("new_path", ""))
        if not src.exists():
            return f"Error: Not found: {args.get('old_path')}"
        dst.parent.mkdir(parents=True, exist_ok=True)
        src.rename(dst)
        return f"Renamed {args.get('old_path')} \u2192 {args.get('new_path')}"

    elif name == "execute_code":
        import os as _os
        import tempfile as _tmpfile

        code = args.get("code", "")
        language = args.get("language", "python")

        ext = {"python": ".py", "javascript": ".js", "bash": ".sh"}.get(language, ".txt")
        cmd = {
            "python": ["python3"],
            "javascript": ["node"],
            "bash": ["bash"],
        }.get(language, ["cat"])

        with _tmpfile.NamedTemporaryFile(
            mode="w", suffix=ext, delete=False, encoding="utf-8"
        ) as f:
            f.write(code)
            tmpfile = f.name
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, tmpfile,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(workspace_root),
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
            except asyncio.TimeoutError:
                proc.kill()
                return "Error: Execution timed out after 30s"
            out = stdout.decode("utf-8", errors="replace")
            err = stderr.decode("utf-8", errors="replace")
            code_status = proc.returncode
            result_parts = []
            if out:
                result_parts.append(f"stdout:\n{out}")
            if err:
                result_parts.append(f"stderr:\n{err}")
            result_parts.append(f"exit code: {code_status}")
            return "\n".join(result_parts)
        finally:
            try:
                _os.unlink(tmpfile)
            except OSError:
                pass
    else:
        return f"Unknown tool: {name}"


async def stream_chat_with_file_tools(
    messages: list[dict],
    model: str,
    provider: "Provider | str",
    system_prompt: str | None = None,
    creds: "ProviderCredentials | None" = None,
    workspace_root: "object | None" = None,
) -> AsyncGenerator[str | dict, None]:
    """Agentic streaming chat with file system and code execution tools.

    Runs a multi-turn tool calling loop: the AI can call file tools multiple
    times until it finishes, yielding tokens and tool events throughout.

    Yields:
      - str tokens
      - dict tool events: {"tool_call": name, "args": {...}}
                          {"tool_result": name, "result": "..."}
    """
    from pathlib import Path as _Path
    if creds is None:
        creds = ProviderCredentials()
    if workspace_root is None:
        workspace_root = _Path("/workspace")

    p = Provider(provider)

    # Ollama: no tool support, fall back to plain streaming
    if p == Provider.OLLAMA:
        async for token in stream_chat(messages, model, p, system_prompt, creds):
            yield token
        return

    LABS_SYSTEM = """You are an expert AI coding assistant in LocalMind Labs.
You have access to a workspace where you can create, read, edit, and delete files,
and execute code (Python, JavaScript, Bash).

Be proactive: when asked to build something, actually CREATE the files.
When asked to run code, actually EXECUTE it and report results.
Use tools autonomously — don't ask permission, just do it.
After writing files, execute them to verify they work correctly.
Be thorough and complete tasks end-to-end."""

    resolved_system = system_prompt or LABS_SYSTEM

    # Agentic loop — run up to 10 tool-call rounds
    current_messages = list(messages)
    MAX_ROUNDS = 10

    if p == Provider.ANTHROPIC:
        # Anthropic agentic loop
        client = anthropic.AsyncAnthropic(api_key=creds.get_anthropic())
        chat_messages = [m for m in current_messages if m["role"] != "system"]

        for _round in range(MAX_ROUNDS):
            tool_use_blocks_acc: dict[int, dict] = {}
            content_tokens: list[str] = []
            stop_reason = None

            stream_kwargs: dict = {
                "model": model,
                "max_tokens": 8192,
                "messages": chat_messages,
                "tools": FILE_TOOLS_ANTHROPIC,
                "system": resolved_system,
            }

            try:
                async with client.messages.stream(**stream_kwargs) as stream:
                    async for event in stream:
                        event_type = getattr(event, "type", None)

                        if event_type == "content_block_start":
                            block = getattr(event, "content_block", None)
                            if block and getattr(block, "type", None) == "tool_use":
                                idx = getattr(event, "index", 0)
                                tool_use_blocks_acc[idx] = {
                                    "id": getattr(block, "id", ""),
                                    "name": getattr(block, "name", ""),
                                    "input_str": "",
                                }
                        elif event_type == "content_block_delta":
                            delta = getattr(event, "delta", None)
                            if delta:
                                delta_type = getattr(delta, "type", None)
                                if delta_type == "text_delta":
                                    text = getattr(delta, "text", "")
                                    if text:
                                        content_tokens.append(text)
                                        yield text
                                elif delta_type == "input_json_delta":
                                    idx = getattr(event, "index", 0)
                                    partial = getattr(delta, "partial_json", "")
                                    if idx in tool_use_blocks_acc and partial:
                                        tool_use_blocks_acc[idx]["input_str"] += partial
                        elif event_type == "message_delta":
                            delta = getattr(event, "delta", None)
                            if delta:
                                stop_reason = getattr(delta, "stop_reason", stop_reason)
            except Exception as exc:
                log.warning("Anthropic file tools error: %s", exc)
                yield f"\n\nError: {exc}"
                return

            if stop_reason != "tool_use" or not tool_use_blocks_acc:
                break  # Done

            # Build assistant message with tool use blocks
            reconstructed: list[dict] = []
            if content_tokens:
                reconstructed.append({"type": "text", "text": "".join(content_tokens)})
            for tb in tool_use_blocks_acc.values():
                try:
                    input_data = json.loads(tb["input_str"]) if tb["input_str"] else {}
                except Exception:
                    input_data = {}
                reconstructed.append({
                    "type": "tool_use",
                    "id": tb["id"],
                    "name": tb["name"],
                    "input": input_data,
                })
            chat_messages = list(chat_messages) + [{"role": "assistant", "content": reconstructed}]

            # Execute tools and collect results
            tool_results = []
            for tb in tool_use_blocks_acc.values():
                try:
                    input_data = json.loads(tb["input_str"]) if tb["input_str"] else {}
                except Exception:
                    input_data = {}
                yield {"tool_call": tb["name"], "args": input_data}
                result = await _execute_file_tool(tb["name"], input_data, workspace_root)
                yield {"tool_result": tb["name"], "result": result[:500]}
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tb["id"],
                    "content": result,
                })
            chat_messages.append({"role": "user", "content": tool_results})

    else:
        # OpenAI-compatible agentic loop (OpenAI, Cerebras, Vercel)
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
            async for token in stream_chat(messages, model, p, system_prompt, creds):
                yield token
            return

        full_messages = _prepend_system(current_messages, resolved_system)

        for _round in range(MAX_ROUNDS):
            tool_calls_acc: dict[int, dict] = {}
            content_tokens: list[str] = []
            finish_reason = None

            try:
                stream = await client.chat.completions.create(
                    model=model,
                    messages=full_messages,  # type: ignore[arg-type]
                    tools=FILE_TOOLS_OPENAI,  # type: ignore[arg-type]
                    tool_choice="auto",
                    max_tokens=8192,
                    stream=True,
                )
                async for chunk in stream:
                    if not chunk.choices:
                        continue
                    choice = chunk.choices[0]
                    if choice.finish_reason:
                        finish_reason = choice.finish_reason
                    delta = choice.delta
                    if delta.content:
                        content_tokens.append(delta.content)
                        yield delta.content
                    if delta.tool_calls:
                        for tc_delta in delta.tool_calls:
                            idx = tc_delta.index
                            if idx not in tool_calls_acc:
                                tool_calls_acc[idx] = {"id": "", "name": "", "arguments": ""}
                            if tc_delta.id:
                                tool_calls_acc[idx]["id"] += tc_delta.id
                            if tc_delta.function:
                                if tc_delta.function.name:
                                    tool_calls_acc[idx]["name"] += tc_delta.function.name
                                if tc_delta.function.arguments:
                                    tool_calls_acc[idx]["arguments"] += tc_delta.function.arguments
            except Exception as exc:
                log.warning("OpenAI file tools error: %s", exc)
                yield f"\n\nError: {exc}"
                return

            if finish_reason != "tool_calls" or not tool_calls_acc:
                break  # Done

            # Append assistant's turn with tool calls
            full_messages = list(full_messages) + [
                {
                    "role": "assistant",
                    "content": "".join(content_tokens) or None,
                    "tool_calls": [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": {"name": tc["name"], "arguments": tc["arguments"]},
                        }
                        for tc in tool_calls_acc.values()
                    ],
                }
            ]

            # Execute tools
            for tc in tool_calls_acc.values():
                try:
                    args = json.loads(tc["arguments"]) if tc["arguments"] else {}
                except Exception:
                    args = {}
                yield {"tool_call": tc["name"], "args": args}
                result = await _execute_file_tool(tc["name"], args, workspace_root)
                yield {"tool_result": tc["name"], "result": result[:500]}
                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })
