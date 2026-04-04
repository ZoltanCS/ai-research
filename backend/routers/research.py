"""Research endpoints.

New endpoints
-------------
POST /api/research/start           — begin a deep research run (SSE stream)
GET  /api/research/reports         — list all saved reports
GET  /api/research/reports/{id}    — retrieve a specific report

Legacy endpoint (preserved for backwards compatibility)
-------------------------------------------------------
POST /api/research/search
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.database import ResearchReport
from models.schemas import (
    ResearchReportOut,
    ResearchRequest,
    ResearchSourceOut,
    SearchRequest,
    SearchResponse,
)
from services.research_agent import ResearchAgent
from services.search import web_search

router = APIRouter()


# ── Deep Research ─────────────────────────────────────────────────────────────

@router.post("/start")
async def start_research(
    request: ResearchRequest,
    db: AsyncSession = Depends(get_db),
):
    """Begin an autonomous deep-research run and stream SSE progress events."""
    agent = ResearchAgent(db)

    async def event_stream():
        gen = await agent.run(
            query=request.query,
            model=request.model,
            provider=request.provider,
            max_sub_questions=request.max_sub_questions,
            max_results_per_query=request.max_results_per_query,
            top_k_sources=request.top_k_sources,
        )
        async for event in gen:
            yield f"data: {event}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/reports", response_model=list[ResearchReportOut])
async def list_reports(
    db: AsyncSession = Depends(get_db),
    limit: int = 20,
    offset: int = 0,
):
    """Return saved research reports, most recent first."""
    stmt = (
        select(ResearchReport)
        .order_by(ResearchReport.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_schema(r) for r in rows]


@router.get("/reports/{report_id}", response_model=ResearchReportOut)
async def get_report(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Retrieve a single research report by ID."""
    row = await db.get(ResearchReport, report_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return _to_schema(row)


# ── Legacy endpoint ───────────────────────────────────────────────────────────

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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_schema(row: ResearchReport) -> ResearchReportOut:
    sources = [
        ResearchSourceOut(
            title=s.get("title", s.get("url", "")),
            url=s.get("url", ""),
            query=s.get("query", ""),
        )
        for s in (row.sources or [])
    ]
    return ResearchReportOut(
        id=row.id,
        query=row.query,
        sub_questions=list(row.sub_questions or []),
        sources=sources,
        report=row.report,
        model=row.model,
        provider=row.provider,
        created_at=row.created_at,
    )
