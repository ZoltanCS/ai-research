"""RAG query endpoint — semantic + keyword hybrid search with source attribution."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.schemas import RAGQueryRequest, RAGQueryResponse, RetrievedChunkOut
from services.rag_service import assemble_context, hybrid_search

router = APIRouter()


@router.post("/query", response_model=RAGQueryResponse)
async def rag_query(
    request: RAGQueryRequest,
    db: AsyncSession = Depends(get_db),
):
    """Retrieve the most relevant document chunks for *query* and return them
    with source attribution.

    - ``hybrid_alpha=1.0``  → pure semantic search
    - ``hybrid_alpha=0.0``  → pure keyword search
    - ``hybrid_alpha=0.7``  → default (semantic-leaning blend)

    Set ``include_context=true`` to also receive a ready-to-use context string
    suitable for insertion into an LLM prompt.
    """
    try:
        chunks, timing = await hybrid_search(
            db,
            query=request.query,
            top_k=request.top_k,
            document_ids=request.document_ids,
            alpha=request.hybrid_alpha,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Retrieval failed: {exc}")

    chunk_outs = [
        RetrievedChunkOut(
            chunk_id=c.chunk_id,
            document_id=c.document_id,
            filename=c.filename,
            chunk_index=c.chunk_index,
            content=c.content,
            semantic_score=c.semantic_score,
            keyword_score=c.keyword_score,
            combined_score=c.combined_score,
        )
        for c in chunks
    ]

    context: str | None = None
    if request.include_context:
        context = assemble_context(chunks, request.query)

    return RAGQueryResponse(
        query=request.query,
        chunks=chunk_outs,
        context=context,
        semantic_search_ms=round(timing["semantic"], 1),
        keyword_search_ms=round(timing["keyword"], 1),
        total_ms=round(timing["total"], 1),
    )
