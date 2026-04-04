"""Tavily web search service."""

import httpx

from core.config import settings
from models.schemas import SearchResponse, SearchResult

TAVILY_API_URL = "https://api.tavily.com/search"


async def web_search(
    query: str,
    max_results: int = 5,
    include_answer: bool = True,
) -> SearchResponse:
    if not settings.tavily_api_key:
        raise ValueError("TAVILY_API_KEY is not configured")

    payload = {
        "api_key": settings.tavily_api_key,
        "query": query,
        "max_results": max_results,
        "include_answer": include_answer,
        "search_depth": "basic",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(TAVILY_API_URL, json=payload)
        response.raise_for_status()
        data = response.json()

    results = [
        SearchResult(
            title=r.get("title", ""),
            url=r.get("url", ""),
            content=r.get("content", ""),
            score=r.get("score"),
        )
        for r in data.get("results", [])
    ]

    return SearchResponse(
        query=query,
        answer=data.get("answer"),
        results=results,
    )


def format_search_context(search_response: SearchResponse) -> str:
    lines = []
    if search_response.answer:
        lines.append(f"Summary: {search_response.answer}\n")
    for i, result in enumerate(search_response.results, 1):
        lines.append(f"[{i}] {result.title}\n{result.url}\n{result.content}\n")
    return "\n".join(lines)
