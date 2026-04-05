"""Web search service — Exa (primary) with Tavily fallback.

Exa is designed for AI agents and supports up to 100 results per query.
Tavily is used as fallback if no Exa key is configured.

Results are cached in Redis for ``settings.web_cache_ttl`` seconds (default 1h).
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass

import httpx
import redis.asyncio as aioredis
from bs4 import BeautifulSoup

from core.config import settings

log = logging.getLogger(__name__)

TAVILY_API_URL = "https://api.tavily.com/search"
EXA_API_URL = "https://api.exa.ai"


# ── Result types ──────────────────────────────────────────────────────────────

@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    content: str | None = None
    score: float | None = None
    provider: str = ""

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "content": self.content,
            "score": self.score,
            "provider": self.provider,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "SearchResult":
        return cls(**d)


@dataclass
class SearchResponse:
    query: str
    results: list[SearchResult]
    answer: str | None = None
    cached: bool = False
    provider: str = ""


# ── Redis cache ───────────────────────────────────────────────────────────────

_redis_client: aioredis.Redis | None = None


async def _get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = await aioredis.from_url(
            settings.redis_url, decode_responses=True
        )
    return _redis_client


def _cache_key(query: str, max_results: int, include_content: bool) -> str:
    digest = hashlib.sha256(
        f"{query}:{max_results}:{include_content}".encode()
    ).hexdigest()[:16]
    return f"web_search:{digest}"


async def _load_cache(key: str) -> SearchResponse | None:
    try:
        r = await _get_redis()
        raw = await r.get(key)
        if raw is None:
            return None
        data = json.loads(raw)
        results = [SearchResult.from_dict(item) for item in data["results"]]
        return SearchResponse(
            query=data["query"],
            results=results,
            answer=data.get("answer"),
            cached=True,
            provider=data.get("provider", ""),
        )
    except Exception as exc:
        log.warning("Redis cache read failed: %s", exc)
        return None


async def _save_cache(key: str, response: SearchResponse) -> None:
    try:
        r = await _get_redis()
        payload = json.dumps({
            "query": response.query,
            "results": [res.to_dict() for res in response.results],
            "answer": response.answer,
            "provider": response.provider,
        })
        await r.setex(key, settings.web_cache_ttl, payload)
    except Exception as exc:
        log.warning("Redis cache write failed: %s", exc)


# ── URL scraping ──────────────────────────────────────────────────────────────

async def scrape_url(url: str) -> str | None:
    try:
        async with httpx.AsyncClient(
            timeout=settings.web_search_timeout,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; LocalMind/0.1)"},
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            if "html" not in resp.headers.get("content-type", ""):
                return None

        soup = BeautifulSoup(resp.text, "lxml")
        for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form", "noscript"]):
            tag.decompose()

        for selector in ("main", "article", '[role="main"]', ".content", "#content"):
            container = soup.select_one(selector)
            if container:
                text = container.get_text(separator="\n", strip=True)
                break
        else:
            text = soup.get_text(separator="\n", strip=True)

        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        return "\n".join(lines)[: settings.web_scrape_max_chars]
    except Exception as exc:
        log.debug("Scrape failed for %s: %s", url, exc)
        return None


# ── Exa ───────────────────────────────────────────────────────────────────────

async def _search_exa(
    query: str,
    max_results: int,
    include_content: bool,
    api_key: str,
) -> SearchResponse:
    # Exa supports up to 100 results per call, neural search designed for AI
    payload: dict = {
        "query": query,
        "numResults": min(max_results, 100),
        "type": "neural",
        "useAutoprompt": True,
    }
    if include_content:
        payload["contents"] = {"text": {"maxCharacters": settings.web_scrape_max_chars}}
    else:
        payload["contents"] = {"summary": {"query": query}}

    async with httpx.AsyncClient(
        base_url=EXA_API_URL,
        timeout=settings.web_search_timeout,
        headers={"x-api-key": api_key, "Content-Type": "application/json"},
    ) as client:
        resp = await client.post("/search", json=payload)
        resp.raise_for_status()
        data = resp.json()

    results = []
    for item in data.get("results", []):
        snippet = ""
        content = None
        if include_content:
            content = (item.get("text") or "")[:settings.web_scrape_max_chars]
            snippet = content[:300] if content else ""
        else:
            snippet = item.get("summary") or item.get("text", "")[:300]

        results.append(SearchResult(
            title=item.get("title", ""),
            url=item.get("url", ""),
            snippet=snippet,
            content=content if include_content else None,
            score=item.get("score"),
            provider="exa",
        ))

    return SearchResponse(query=query, results=results, provider="exa")


# ── Tavily (fallback) ─────────────────────────────────────────────────────────

async def _search_tavily(
    query: str,
    max_results: int,
    include_content: bool,
    api_key: str,
) -> SearchResponse:
    payload = {
        "api_key": api_key,
        "query": query,
        "max_results": min(max_results, 10),  # Tavily caps at 10
        "include_answer": True,
        "search_depth": "basic",
    }

    async with httpx.AsyncClient(timeout=settings.web_search_timeout) as client:
        resp = await client.post(TAVILY_API_URL, json=payload)
        resp.raise_for_status()
        data = resp.json()

    results = []
    for item in data.get("results", []):
        content: str | None = None
        if include_content:
            content = item.get("raw_content") or await scrape_url(item["url"])
        results.append(SearchResult(
            title=item.get("title", ""),
            url=item.get("url", ""),
            snippet=item.get("content", ""),
            content=content,
            score=item.get("score"),
            provider="tavily",
        ))

    return SearchResponse(
        query=query,
        results=results,
        answer=data.get("answer"),
        provider="tavily",
    )


# ── Public entry point ────────────────────────────────────────────────────────

async def search(
    query: str,
    max_results: int = 10,
    include_content: bool = False,
    *,
    bypass_cache: bool = False,
    exa_key: str = "",
    tavily_key: str = "",
) -> SearchResponse:
    """Search the web. Uses Exa if configured, falls back to Tavily.

    Raises ``RuntimeError`` if neither key is available.
    """
    exa_key = exa_key or settings.exa_api_key
    tavily_key = tavily_key or settings.tavily_api_key

    if not exa_key and not tavily_key:
        raise RuntimeError(
            "No web search API key configured. "
            "Set EXA_API_KEY (recommended) or TAVILY_API_KEY in Admin Settings."
        )

    cache_key = _cache_key(query, max_results, include_content)
    if not bypass_cache:
        cached = await _load_cache(cache_key)
        if cached:
            log.debug("Cache hit for query '%s'", query)
            return cached

    if exa_key:
        response = await _search_exa(query, max_results, include_content, exa_key)
    else:
        response = await _search_tavily(query, max_results, include_content, tavily_key)

    await _save_cache(cache_key, response)
    return response


# ── Helpers ───────────────────────────────────────────────────────────────────

def format_search_context(response: SearchResponse) -> str:
    lines: list[str] = []
    if response.answer:
        lines.append(f"Summary: {response.answer}\n")
    for i, result in enumerate(response.results, 1):
        lines.append(
            f"[{i}] {result.title}\n"
            f"URL: {result.url}\n"
            f"{result.snippet}"
        )
    return "\n\n".join(lines)
