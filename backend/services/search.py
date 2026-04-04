"""Backward-compatibility shim.

routers/chat.py and routers/research.py import from here; the real
implementation lives in services/web_search.py.
"""

from __future__ import annotations

from models.schemas import SearchResponse as _LegacySearchResponse, SearchResult
from services.web_search import SearchResponse as _NewSearchResponse
from services.web_search import format_search_context  # noqa: F401
from services.web_search import search as _search


async def web_search(
    query: str,
    max_results: int = 5,
    include_answer: bool = True,
) -> _LegacySearchResponse:
    """Legacy wrapper returning the old SearchResponse schema."""
    try:
        resp: _NewSearchResponse = await _search(query, max_results)
    except RuntimeError as exc:
        raise ValueError(str(exc)) from exc

    return _LegacySearchResponse(
        query=resp.query,
        answer=resp.answer,
        results=[
            SearchResult(
                title=r.title,
                url=r.url,
                content=r.snippet,
                score=r.score,
            )
            for r in resp.results
        ],
    )
