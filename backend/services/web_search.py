"""Web search service — Tavily only.

Results are cached in Redis for ``settings.web_cache_ttl`` seconds (default 1h).
Full page content is optionally scraped via httpx + BeautifulSoup.
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


# ── Result types ──────────────────────────────────────────────────────────────

@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    content: str | None = None
    score: float | None = None
    provider: str = "tavily"

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
    provider: str = "tavily"


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
            provider=data.get("provider", "tavily"),
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


# ── Content scraping ──────────────────────────────────────────────────────────

async def scrape_url(url: str) -> str | None:
    """Fetch *url* and return cleaned main-body text (best-effort)."""
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (compatible; LocalMind/0.1; "
                "+https://github.com/localai/localmind)"
            )
        }
        async with httpx.AsyncClient(
            timeout=settings.web_search_timeout,
            follow_redirects=True,
        ) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            ct = resp.headers.get("content-type", "")
            if "html" not in ct:
                return None

        soup = BeautifulSoup(resp.text, "lxml")

        for tag in soup(["script", "style", "nav", "header", "footer",
                          "aside", "form", "noscript"]):
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


# ── Tavily ────────────────────────────────────────────────────────────────────

async def _search_tavily(
    query: str,
    max_results: int,
    include_content: bool,
    api_key: str,
) -> SearchResponse:
    payload = {
        "api_key": api_key,
        "query": query,
        "max_results": max_results,
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

        results.append(
            SearchResult(
                title=item.get("title", ""),
                url=item.get("url", ""),
                snippet=item.get("content", ""),
                content=content,
                score=item.get("score"),
            )
        )

    return SearchResponse(
        query=query,
        results=results,
        answer=data.get("answer"),
    )


# ── Public entry point ────────────────────────────────────────────────────────

async def search(
    query: str,
    max_results: int = 5,
    include_content: bool = False,
    *,
    bypass_cache: bool = False,
    tavily_key: str = "",
) -> SearchResponse:
    """Search via Tavily. Raises ``RuntimeError`` if no API key is configured."""
    key = tavily_key or settings.tavily_api_key
    if not key:
        raise RuntimeError(
            "No Tavily API key configured. "
            "Set TAVILY_API_KEY in your .env or add it in Admin Settings."
        )

    cache_key = _cache_key(query, max_results, include_content)

    if not bypass_cache:
        cached = await _load_cache(cache_key)
        if cached is not None:
            log.debug("Cache hit for query '%s'", query)
            return cached

    response = await _search_tavily(query, max_results, include_content, key)
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
