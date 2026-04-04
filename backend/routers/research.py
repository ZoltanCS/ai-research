"""Web research endpoints."""

from fastapi import APIRouter, HTTPException

from models.schemas import SearchRequest, SearchResponse
from services.search import web_search

router = APIRouter()


@router.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    try:
        return await web_search(
            query=request.query,
            max_results=request.max_results,
            include_answer=request.include_answer,
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Search failed: {e}")
