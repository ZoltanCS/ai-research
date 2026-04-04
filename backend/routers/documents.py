"""Document management endpoints.

Routes
------
POST   /api/documents/upload   multipart file upload (canonical)
POST   /api/documents          same upload, kept for backward compat
GET    /api/documents          list all documents (paginated)
GET    /api/documents/{id}     retrieve a single document
DELETE /api/documents/{id}     delete document + cascaded chunks
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.database import Document
from models.schemas import DocumentOut
from services.document_service import ingest_document

router = APIRouter()

_ALLOWED_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
}

_MAX_BYTES = 50 * 1024 * 1024  # 50 MB


async def _handle_upload(file: UploadFile, db: AsyncSession):
    content_type = file.content_type or "application/octet-stream"
    # Normalise text/* subtypes that browsers may send inconsistently
    if content_type.startswith("text/") and content_type not in _ALLOWED_TYPES:
        content_type = "text/plain"

    if content_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported file type: {content_type!r}. "
                f"Allowed: {', '.join(sorted(_ALLOWED_TYPES))}"
            ),
        )

    raw = await file.read()
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")

    doc, created = await ingest_document(
        db,
        filename=file.filename or "upload",
        content_type=content_type,
        file_content=raw,
        deduplicate=True,
    )
    return doc, created


@router.post("/upload", response_model=DocumentOut, status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload and ingest a document.

    Identical documents (same SHA-256) are deduplicated: the existing record
    is returned with HTTP 200 instead of 201.
    """
    doc, created = await _handle_upload(file, db)
    status = 201 if created else 200
    return JSONResponse(
        content=DocumentOut.model_validate(doc).model_dump(mode="json"),
        status_code=status,
    )


@router.post("", response_model=DocumentOut, status_code=201)
async def upload_document_compat(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Backward-compatible alias for POST /api/documents/upload."""
    return await upload_document(file, db)


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
    offset: int = 0,
):
    result = await db.execute(
        select(Document)
        .order_by(Document.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return result.scalars().all()


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await db.delete(doc)
    await db.commit()
