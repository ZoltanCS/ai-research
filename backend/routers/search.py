"""Web search endpoint (POST /api/search/web)."""

from fastapi import APIRouter, HTTPException

from models.schemas import WebSearchRequest, WebSearchResponse, WebSearchResultOut
from services.web_search import search

router = APIRouter()


@router.post("/web", response_model=WebSearchResponse)
async def web_search_endpoint(request: WebSearchRequest):
    """Search the web and return results, optionally with scraped page content.

    Provider selection (automatic, in priority order):
      1. **Tavily**  — set ``TAVILY_API_KEY``
      2. **SearXNG** — set ``SEARXNG_HOST`` (e.g. ``http://localhost:8080``)

    Results are cached in Redis for 1 hour; set ``bypass_cache=true`` (query
    param) to force a fresh fetch.
    """
    try:
        resp = await search(
            query=request.query,
            max_results=request.max_results,
            include_content=request.include_content,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Search failed: {exc}")

    return WebSearchResponse(
        query=resp.query,
        results=[
            WebSearchResultOut(
                title=r.title,
                url=r.url,
                snippet=r.snippet,
                content=r.content,
                score=r.score,
                provider=r.provider,
            )
            for r in resp.results
        ],
        answer=resp.answer,
        cached=resp.cached,
        provider=resp.provider,
    )
