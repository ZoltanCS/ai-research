"""RAG retrieval service.

Provides:
  - semantic_search  — pgvector cosine similarity
  - keyword_search   — PostgreSQL tsvector / tsquery (computed inline)
  - hybrid_search    — Reciprocal Rank Fusion (RRF) of both results
  - assemble_context — format chunks as a cited context block
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from services.document_service import get_embedding

log = logging.getLogger(__name__)

# RRF constant: higher values reduce the impact of rank differences.
_RRF_K = 60


# ── Data types ───────────────────────────────────────────────────────────────��

@dataclass
class RetrievedChunk:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    filename: str
    chunk_index: int
    content: str
    semantic_score: float = 0.0
    keyword_score: float = 0.0
    combined_score: float = 0.0


# ── Semantic search ───────────────────────────────────────────────────────────

async def semantic_search(
    db: AsyncSession,
    query: str,
    top_k: int | None = None,
    document_ids: list[uuid.UUID] | None = None,
) -> list[RetrievedChunk]:
    """Return the *top_k* chunks closest to *query* by cosine similarity."""
    k = top_k or settings.rag_top_k
    # Retrieve 2× as many candidates for RRF fusion
    candidate_k = k * 2

    query_vec = await get_embedding(query)
    vec_str = "[" + ",".join(str(v) for v in query_vec) + "]"

    doc_filter = ""
    params: dict = {"embedding": vec_str, "limit": candidate_k}
    if document_ids:
        doc_filter = "AND dc.document_id = ANY(:doc_ids)"
        params["doc_ids"] = [str(d) for d in document_ids]

    sql = text(f"""
        SELECT
            dc.id            AS chunk_id,
            dc.document_id,
            d.filename,
            dc.chunk_index,
            dc.content,
            1 - (dc.embedding <=> :embedding::vector)  AS score
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE dc.embedding IS NOT NULL
        {doc_filter}
        ORDER BY dc.embedding <=> :embedding::vector
        LIMIT :limit
    """)

    rows = (await db.execute(sql, params)).fetchall()
    return [
        RetrievedChunk(
            chunk_id=row.chunk_id,
            document_id=row.document_id,
            filename=row.filename,
            chunk_index=row.chunk_index,
            content=row.content,
            semantic_score=float(row.score),
        )
        for row in rows
    ]


# ── Keyword search ────────────────────────────────────────────────────────────

async def keyword_search(
    db: AsyncSession,
    query: str,
    top_k: int | None = None,
    document_ids: list[uuid.UUID] | None = None,
) -> list[RetrievedChunk]:
    """Full-text search using PostgreSQL tsvector, computed inline."""
    k = top_k or settings.rag_top_k
    candidate_k = k * 2

    doc_filter = ""
    params: dict = {"query": query, "limit": candidate_k}
    if document_ids:
        doc_filter = "AND dc.document_id = ANY(:doc_ids)"
        params["doc_ids"] = [str(d) for d in document_ids]

    # plainto_tsquery handles arbitrary user text safely (no special operators).
    sql = text(f"""
        SELECT
            dc.id            AS chunk_id,
            dc.document_id,
            d.filename,
            dc.chunk_index,
            dc.content,
            ts_rank(
                to_tsvector('english', dc.content),
                plainto_tsquery('english', :query)
            )                AS score
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE to_tsvector('english', dc.content) @@ plainto_tsquery('english', :query)
        {doc_filter}
        ORDER BY score DESC
        LIMIT :limit
    """)

    rows = (await db.execute(sql, params)).fetchall()
    return [
        RetrievedChunk(
            chunk_id=row.chunk_id,
            document_id=row.document_id,
            filename=row.filename,
            chunk_index=row.chunk_index,
            content=row.content,
            keyword_score=float(row.score),
        )
        for row in rows
    ]


# ── Reciprocal Rank Fusion ────────────────────────────────────────────────────

def _rrf_score(rank: int) -> float:
    """RRF score for a result at zero-based *rank*."""
    return 1.0 / (_RRF_K + rank + 1)


def _fuse(
    semantic: list[RetrievedChunk],
    keyword: list[RetrievedChunk],
    alpha: float,
    top_k: int,
) -> list[RetrievedChunk]:
    """Fuse two ranked lists using Reciprocal Rank Fusion.

    *alpha* controls semantic weight (1.0 = pure semantic, 0.0 = pure keyword).
    The combined score is a weighted sum of per-list RRF scores:

        combined = alpha * rrf_semantic + (1 - alpha) * rrf_keyword
    """
    # Index both lists by chunk_id for fast merging
    by_id: dict[uuid.UUID, RetrievedChunk] = {}

    for rank, chunk in enumerate(semantic):
        cid = chunk.chunk_id
        if cid not in by_id:
            by_id[cid] = chunk
        by_id[cid].combined_score += alpha * _rrf_score(rank)
        by_id[cid].semantic_score = chunk.semantic_score

    for rank, chunk in enumerate(keyword):
        cid = chunk.chunk_id
        if cid not in by_id:
            by_id[cid] = chunk
        by_id[cid].combined_score += (1 - alpha) * _rrf_score(rank)
        by_id[cid].keyword_score = chunk.keyword_score

    ranked = sorted(by_id.values(), key=lambda c: c.combined_score, reverse=True)
    return ranked[:top_k]


# ── Hybrid search (public entry point) ───────────────────────────────────────

async def hybrid_search(
    db: AsyncSession,
    query: str,
    top_k: int | None = None,
    document_ids: list[uuid.UUID] | None = None,
    alpha: float | None = None,
) -> tuple[list[RetrievedChunk], dict]:
    """Run semantic + keyword search and fuse the results.

    Returns ``(chunks, timing_ms)`` where *timing_ms* is a dict with
    ``semantic``, ``keyword``, and ``total`` keys.
    """
    k = top_k or settings.rag_top_k
    a = alpha if alpha is not None else settings.rag_hybrid_alpha

    t0 = time.perf_counter()
    sem_results = await semantic_search(db, query, k, document_ids)
    t1 = time.perf_counter()
    kw_results = await keyword_search(db, query, k, document_ids)
    t2 = time.perf_counter()

    fused = _fuse(sem_results, kw_results, a, k)
    t3 = time.perf_counter()

    timing = {
        "semantic": (t1 - t0) * 1000,
        "keyword": (t2 - t1) * 1000,
        "total": (t3 - t0) * 1000,
    }
    log.debug("hybrid_search '%s': %d chunks in %.1f ms", query, len(fused), timing["total"])
    return fused, timing


# ── Context assembly ──────────────────────────────────────────────────────────

def assemble_context(chunks: list[RetrievedChunk], query: str) -> str:
    """Format retrieved chunks as a prompt-ready context block with citations.

    Each chunk is annotated with [SOURCE N: filename, chunk index] so the LLM
    can reference it in citations.
    """
    if not chunks:
        return ""

    header = (
        "The following context passages were retrieved from your document library.\n"
        "When answering, cite sources as [SOURCE N].\n\n"
    )
    body_parts = []
    for i, chunk in enumerate(chunks, 1):
        body_parts.append(
            f"[SOURCE {i}: {chunk.filename}, chunk {chunk.chunk_index}]"
            f" (relevance: {chunk.combined_score:.3f})\n"
            f"{chunk.content}"
        )

    footer = f"\n\nQuestion: {query}"
    return header + "\n\n---\n\n".join(body_parts) + footer


# ── Backward-compat helpers (used by routers/chat.py via services/rag.py) ─────

async def retrieve_context(
    db: AsyncSession,
    query: str,
    max_results: int | None = None,
) -> list[dict]:
    """Thin wrapper returning dicts for backward compatibility."""
    chunks, _ = await hybrid_search(db, query, top_k=max_results)
    return [
        {
            "content": c.content,
            "filename": c.filename,
            "chunk_index": c.chunk_index,
            "score": c.combined_score,
            "document_id": str(c.document_id),
        }
        for c in chunks
    ]


def build_rag_prompt(query: str, context_chunks: list[dict]) -> str:
    """Format context dicts into a prompt string (backward compat)."""
    converted = [
        RetrievedChunk(
            chunk_id=uuid.UUID(c.get("chunk_id", str(uuid.uuid4()))),
            document_id=uuid.UUID(c.get("document_id", str(uuid.uuid4()))),
            filename=c["filename"],
            chunk_index=c["chunk_index"],
            content=c["content"],
            combined_score=c.get("score", 0.0),
        )
        for c in context_chunks
    ]
    return assemble_context(converted, query)
