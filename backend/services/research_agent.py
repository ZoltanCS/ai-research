"""Deep Research Agent.

Four-step pipeline
------------------
1. Decompose — break the user query into sub-questions via LLM (JSON output).
2. Search    — run parallel web searches for each sub-question.
3. Scrape    — extract content from the top URLs concurrently.
4. Synthesise — stream a structured markdown report using all gathered context.

All steps emit SSE-compatible JSON strings so the router can forward them
verbatim as ``data: ...\n\n`` events.

SSE event shapes
----------------
{"type": "progress", "step": "decompose"|"search"|"scrape"|"synthesise",
 "message": "...", "detail": {...}}
{"type": "token", "delta": "..."}         # during synthesis stream
{"type": "complete", "report_id": "...", "report": "..."}
{"type": "error", "message": "..."}
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.database import ResearchReport
from services.ai_provider import Provider, ProviderCredentials, complete_chat, stream_chat
from services.web_search import scrape_url, search

log = logging.getLogger(__name__)

# ── Prompts ───────────────────────────────────────────────────────────────────

_DECOMPOSE_SYSTEM = """\
You are a research planner. Given a research question, produce a JSON array of
focused sub-questions that together cover all important aspects.
Output ONLY a raw JSON array of strings — no markdown fences, no explanation.
Example: ["What is X?", "How does Y affect X?", "What are the limitations of Z?"]"""

_SYNTHESISE_SYSTEM = """\
You are an expert research analyst. Write a comprehensive, well-structured
markdown report that synthesises the provided source material to answer the
research question. Use headers, bullet points, and citations like [Source N].
Be thorough, accurate, and cite your sources."""


# ── JSON parsing helpers ──────────────────────────────────────────────────────

def _parse_sub_questions(raw: str, max_q: int) -> list[str]:
    """Extract a list of strings from LLM output using multiple fallbacks."""
    text = raw.strip()

    # 1. Direct JSON parse (most reliable)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(q) for q in parsed if q][:max_q]
    except json.JSONDecodeError:
        pass

    # 2. Regex: find first [...] block even if surrounded by prose
    m = re.search(r"\[.*?\]", text, re.DOTALL)
    if m:
        try:
            parsed = json.loads(m.group())
            if isinstance(parsed, list):
                return [str(q) for q in parsed if q][:max_q]
        except json.JSONDecodeError:
            pass

    # 3. Numbered / bulleted list fallback
    lines = [
        re.sub(r"^[\d\.\-\*\s]+", "", ln).strip()
        for ln in text.splitlines()
        if ln.strip() and re.match(r"^[\d\.\-\*]", ln.strip())
    ]
    if lines:
        return [ln for ln in lines if ln][:max_q]

    # 4. Last resort: treat each non-empty line as a sub-question
    return [ln.strip() for ln in text.splitlines() if ln.strip()][:max_q]


# ── Agent ─────────────────────────────────────────────────────────────────────

class ResearchAgent:
    """Orchestrates the four-step deep research pipeline."""

    def __init__(self, db: AsyncSession, creds: ProviderCredentials | None = None) -> None:
        self._db = db
        self._creds = creds or ProviderCredentials()

    async def run(
        self,
        query: str,
        model: str,
        provider: Provider | str,
        max_sub_questions: int | None = None,
        max_results_per_query: int | None = None,
        top_k_sources: int | None = None,
    ) -> AsyncGenerator[str, None]:
        """Yield SSE-compatible JSON strings for the full research pipeline."""
        return self._pipeline(
            query=query,
            model=model,
            provider=provider,
            max_sub_questions=max_sub_questions or settings.research_max_sub_questions,
            max_results_per_query=max_results_per_query or settings.research_max_results_per_query,
            top_k_sources=top_k_sources or settings.research_top_k_sources,
        )

    async def _pipeline(
        self,
        query: str,
        model: str,
        provider: Provider | str,
        max_sub_questions: int,
        max_results_per_query: int,
        top_k_sources: int,
    ) -> AsyncGenerator[str, None]:
        # ── Step 1: Decompose ────────────────────────────────────────────────
        yield _progress("decompose", f"Breaking down: {query!r}")
        try:
            sub_questions = await self._decompose(
                query, model, provider, max_sub_questions
            )
        except Exception as exc:
            log.exception("Decompose failed")
            yield _error(f"Query decomposition failed: {exc}")
            return

        yield _progress(
            "decompose",
            f"Generated {len(sub_questions)} sub-questions",
            detail={"sub_questions": sub_questions},
        )

        # ── Step 2: Parallel web search ──────────────────────────────────────
        yield _progress("search", f"Searching {len(sub_questions)} sub-questions …")
        search_results = await self._search_all(sub_questions, max_results_per_query)

        total_results = sum(len(r) for r in search_results.values())
        yield _progress(
            "search",
            f"Retrieved {total_results} results across all sub-questions",
        )

        # ── Step 3: Scrape top sources ───────────────────────────────────────
        all_urls = _deduplicate_urls(search_results, top_k_sources)
        yield _progress("scrape", f"Extracting content from {len(all_urls)} sources …")

        scraped = await self._scrape_all(all_urls)
        yield _progress(
            "scrape",
            f"Successfully scraped {sum(1 for v in scraped.values() if v)} sources",
        )

        # ── Step 4: Synthesis ────────────────────────────────────────────────
        yield _progress("synthesise", "Synthesising report …")

        sources: list[dict] = []
        context_parts: list[str] = []
        for idx, url in enumerate(all_urls, start=1):
            # Find which sub-question produced this URL
            sq = _url_to_query(url, search_results)
            # Find metadata (title, snippet)
            meta = _url_meta(url, search_results)
            sources.append({"title": meta.get("title", url), "url": url, "query": sq})
            content = scraped.get(url) or meta.get("snippet", "")
            context_parts.append(f"[Source {idx}] {meta.get('title', url)}\nURL: {url}\n{content}")

        context = "\n\n---\n\n".join(context_parts)
        synthesis_prompt = (
            f"Research question: {query}\n\n"
            f"Sub-questions investigated:\n"
            + "\n".join(f"- {q}" for q in sub_questions)
            + f"\n\nSource material:\n\n{context}"
        )

        report_tokens: list[str] = []
        try:
            async for token in stream_chat(
                messages=[{"role": "user", "content": synthesis_prompt}],
                model=model,
                provider=provider,
                system_prompt=_SYNTHESISE_SYSTEM,
                creds=self._creds,
            ):
                report_tokens.append(token)
                yield _token(token)
        except Exception as exc:
            log.exception("Synthesis streaming failed")
            yield _error(f"Synthesis failed: {exc}")
            return

        full_report = "".join(report_tokens)

        # ── Persist to DB ────────────────────────────────────────────────────
        report_id = await self._save(
            query=query,
            sub_questions=sub_questions,
            sources=sources,
            report=full_report,
            model=model,
            provider=str(provider),
        )

        yield _complete(report_id=str(report_id), report=full_report)

    # ── Private helpers ───────────────────────────────────────────────────────

    async def _decompose(
        self,
        query: str,
        model: str,
        provider: Provider | str,
        max_q: int,
    ) -> list[str]:
        raw = await complete_chat(
            messages=[{"role": "user", "content": query}],
            model=model,
            provider=provider,
            system_prompt=_DECOMPOSE_SYSTEM,
            creds=self._creds,
        )
        questions = _parse_sub_questions(raw, max_q)
        if not questions:
            questions = [query]
        return questions

    async def _search_all(
        self,
        sub_questions: list[str],
        max_results: int,
    ) -> dict[str, list[dict]]:
        """Run all sub-question searches concurrently."""
        tasks = [
            search(q, max_results=max_results, include_content=False)
            for q in sub_questions
        ]
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        result: dict[str, list[dict]] = {}
        for q, resp in zip(sub_questions, responses):
            if isinstance(resp, Exception):
                log.warning("Search failed for %r: %s", q, resp)
                result[q] = []
            else:
                result[q] = [
                    {
                        "url": r.url,
                        "title": r.title,
                        "snippet": r.snippet,
                    }
                    for r in resp.results
                ]
        return result

    async def _scrape_all(self, urls: list[str]) -> dict[str, str | None]:
        """Scrape all URLs concurrently."""
        tasks = [scrape_url(url) for url in urls]
        contents = await asyncio.gather(*tasks, return_exceptions=True)
        return {
            url: (None if isinstance(c, Exception) else c)
            for url, c in zip(urls, contents)
        }

    async def _save(
        self,
        query: str,
        sub_questions: list[str],
        sources: list[dict],
        report: str,
        model: str,
        provider: str,
    ) -> uuid.UUID:
        row = ResearchReport(
            query=query,
            sub_questions=sub_questions,
            sources=sources,
            report=report,
            model=model,
            provider=provider,
        )
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        return row.id


# ── SSE event builders ────────────────────────────────────────────────────────

def _progress(step: str, message: str, detail: dict | None = None) -> str:
    payload: dict = {"type": "progress", "step": step, "message": message}
    if detail:
        payload["detail"] = detail
    return json.dumps(payload)


def _token(delta: str) -> str:
    return json.dumps({"type": "token", "delta": delta})


def _complete(report_id: str, report: str) -> str:
    return json.dumps({"type": "complete", "report_id": report_id, "report": report})


def _error(message: str) -> str:
    return json.dumps({"type": "error", "message": message})


# ── URL helpers ───────────────────────────────────────────────────────────────

def _deduplicate_urls(
    search_results: dict[str, list[dict]], top_k: int
) -> list[str]:
    """Collect unique URLs from all sub-question results, up to top_k."""
    seen: set[str] = set()
    urls: list[str] = []
    for results in search_results.values():
        for r in results:
            url = r["url"]
            if url not in seen:
                seen.add(url)
                urls.append(url)
                if len(urls) >= top_k:
                    return urls
    return urls


def _url_to_query(url: str, search_results: dict[str, list[dict]]) -> str:
    for q, results in search_results.items():
        if any(r["url"] == url for r in results):
            return q
    return ""


def _url_meta(url: str, search_results: dict[str, list[dict]]) -> dict:
    for results in search_results.values():
        for r in results:
            if r["url"] == url:
                return r
    return {"url": url, "title": url, "snippet": ""}
