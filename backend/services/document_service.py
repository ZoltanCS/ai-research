"""Document ingestion service.

Handles:
  1. Text extraction  — PDF (PyPDF2), DOCX (python-docx), TXT/MD
  2. Chunking         — RecursiveCharacterTextSplitter (token-aware, no LangChain)
  3. Embedding        — Ollama nomic-embed-text  OR  OpenAI text-embedding-3-small
  4. Storage          — PostgreSQL via SQLAlchemy async + pgvector
"""

from __future__ import annotations

import hashlib
import io
import logging
import uuid
from dataclasses import dataclass

import docx as python_docx
import PyPDF2
import tiktoken
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import httpx
from core.config import settings
from models.database import Document, DocumentChunk

log = logging.getLogger(__name__)

# Tiktoken encoder – cl100k_base is used by GPT-4 and is a good approximation
# for other models (Llama, Mistral, etc.).
_ENCODER = tiktoken.get_encoding("cl100k_base")

# Separators tried in order; we fall back to finer granularity if a piece is
# still too large after splitting on the current separator.
_SEPARATORS = ["\n\n", "\n", ". ", " ", ""]


# ── Text extraction ───────────────────────────────────────────────────────────

def _extract_pdf(raw: bytes) -> str:
    reader = PyPDF2.PdfReader(io.BytesIO(raw))
    pages = []
    for page in reader.pages:
        text = page.extract_text() or ""
        if text.strip():
            pages.append(text)
    return "\n\n".join(pages)


def _extract_docx(raw: bytes) -> str:
    doc = python_docx.Document(io.BytesIO(raw))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(paragraphs)


def _extract_txt(raw: bytes) -> str:
    return raw.decode("utf-8", errors="replace")


def extract_text(raw: bytes, content_type: str) -> str:
    """Return plain text from raw file bytes."""
    ct = content_type.lower()
    if "pdf" in ct:
        return _extract_pdf(raw)
    if "word" in ct or "docx" in ct or "officedocument" in ct:
        return _extract_docx(raw)
    # txt / markdown / plain
    return _extract_txt(raw)


# ── Token-aware recursive chunker ────────────────────────────────────────────

@dataclass
class TextChunk:
    content: str
    chunk_index: int
    token_count: int


def _token_len(text: str) -> int:
    return len(_ENCODER.encode(text))


def _split_on_separator(text: str, sep: str) -> list[str]:
    if sep == "":
        # Character-level split: group into ~chunk_size chars as last resort
        size = settings.chunk_size_tokens * 4  # rough char estimate
        return [text[i : i + size] for i in range(0, len(text), size)]
    return text.split(sep)


def _recursive_split(text: str, separators: list[str]) -> list[str]:
    """Split *text* recursively until every piece fits within chunk_size_tokens."""
    if _token_len(text) <= settings.chunk_size_tokens:
        return [text] if text.strip() else []

    sep, *rest_seps = separators
    pieces = _split_on_separator(text, sep)

    result: list[str] = []
    for piece in pieces:
        if _token_len(piece) <= settings.chunk_size_tokens:
            if piece.strip():
                result.append(piece)
        else:
            # Piece still too large — recurse with the next separator
            if rest_seps:
                result.extend(_recursive_split(piece, rest_seps))
            else:
                # No more separators; force-split by character
                result.extend(_recursive_split(piece, [""]))

    return result


def _merge_with_overlap(pieces: list[str]) -> list[TextChunk]:
    """Merge small pieces up to chunk_size_tokens, then slide by (size - overlap)."""
    if not pieces:
        return []

    chunks: list[TextChunk] = []
    current_tokens: list[str] = []  # token-level buffer
    idx = 0

    for piece in pieces:
        piece_toks = _ENCODER.encode(piece)

        # If adding this piece would exceed the limit, flush and start fresh
        # with the overlap window from the end of the current buffer.
        total = len(current_tokens) + len(piece_toks)
        if current_tokens and total > settings.chunk_size_tokens:
            text = _ENCODER.decode(current_tokens)
            if text.strip():
                chunks.append(TextChunk(text.strip(), idx, len(current_tokens)))
                idx += 1
            # Keep the last `overlap` tokens as the new window
            keep = current_tokens[-settings.chunk_overlap_tokens :]
            current_tokens = keep + piece_toks
        else:
            current_tokens.extend(piece_toks)

    # Flush remainder
    if current_tokens:
        text = _ENCODER.decode(current_tokens)
        if text.strip():
            chunks.append(TextChunk(text.strip(), idx, len(current_tokens)))

    return chunks


def split_into_chunks(text: str) -> list[TextChunk]:
    """Split *text* into token-bounded chunks with overlap.

    Strategy mirrors LangChain's RecursiveCharacterTextSplitter:
    try paragraph → line → sentence → word → character boundaries,
    recurse until all pieces fit within ``chunk_size_tokens``.
    Then merge small pieces and add overlap.
    """
    pieces = _recursive_split(text, _SEPARATORS)
    return _merge_with_overlap(pieces)


# ── Embeddings ────────────────────────────────────────────────────────────────

async def _embed_ollama(text: str) -> list[float]:
    async with httpx.AsyncClient(base_url=settings.ollama_host, timeout=30) as client:
        response = await client.post(
            "/api/embeddings",
            json={"model": settings.embedding_model, "prompt": text},
        )
        response.raise_for_status()
        return response.json()["embedding"]


async def _embed_openai(text: str) -> list[float]:
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    resp = await client.embeddings.create(
        model=settings.openai_embedding_model,
        input=text,
        dimensions=settings.embedding_dimensions,  # truncate to 768
    )
    return resp.data[0].embedding


async def get_embedding(text: str) -> list[float]:
    """Return a normalised embedding vector for *text*.

    Delegates to Ollama or OpenAI depending on ``settings.embedding_provider``.
    Falls back to Ollama if OpenAI key is absent.
    """
    if settings.embedding_provider == "openai" and settings.openai_api_key:
        return await _embed_openai(text)
    return await _embed_ollama(text)


# ── Deduplication ─────────────────────────────────────────────────────────────

def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def find_by_sha256(db: AsyncSession, digest: str) -> Document | None:
    result = await db.execute(
        select(Document).where(Document.sha256 == digest)
    )
    return result.scalar_one_or_none()


# ── Ingestion ─────────────────────────────────────────────────────────────────

async def ingest_document(
    db: AsyncSession,
    filename: str,
    content_type: str,
    file_content: bytes,
    *,
    deduplicate: bool = True,
) -> tuple[Document, bool]:
    """Parse, chunk, embed and persist a document.

    Returns ``(document, created)`` where *created* is False when an existing
    document with the same SHA-256 hash was found and returned unchanged.
    """
    digest = sha256_hex(file_content)

    if deduplicate:
        existing = await find_by_sha256(db, digest)
        if existing is not None:
            log.info("Duplicate document '%s' → returning existing %s", filename, existing.id)
            return existing, False

    # ── Extract text ──────────────────────────────────────────────────────────
    raw_text = extract_text(file_content, content_type)
    if not raw_text.strip():
        log.warning("No text extracted from '%s' (type=%s)", filename, content_type)

    # ── Chunk ─────────────────────────────────────────────────────────────────
    chunks = split_into_chunks(raw_text)
    log.info("'%s' → %d chunks (%.1f avg tokens)", filename, len(chunks),
             sum(c.token_count for c in chunks) / max(len(chunks), 1))

    # ── Persist document header ───────────────────────────────────────────────
    doc = Document(
        id=uuid.uuid4(),
        filename=filename,
        content_type=content_type,
        chunk_count=len(chunks),
        file_size=len(file_content),
        sha256=digest,
    )
    db.add(doc)
    await db.flush()

    # ── Embed and persist chunks ──────────────────────────────────────────────
    for chunk in chunks:
        try:
            embedding = await get_embedding(chunk.content)
        except Exception as exc:
            log.error("Embedding failed for chunk %d of '%s': %s", chunk.chunk_index, filename, exc)
            embedding = None  # store chunk without vector; can re-embed later

        db.add(
            DocumentChunk(
                id=uuid.uuid4(),
                document_id=doc.id,
                chunk_index=chunk.chunk_index,
                token_count=chunk.token_count,
                content=chunk.content,
                embedding=embedding,
            )
        )

    await db.commit()
    await db.refresh(doc)
    return doc, True
