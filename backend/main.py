import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from core.config import settings
from core.database import engine
from models.database import Base
from routers import auth, admin, chat, documents, models, rag, research, search

log = logging.getLogger(__name__)

# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: enable pgvector extension, then create all tables
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
    log.info("LocalMind backend started. Tables ready.")
    yield
    # Shutdown
    await engine.dispose()
    log.info("LocalMind backend stopped.")


# ── Application ───────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description=(
        "LocalMind — local AI research and chat. "
        "Supports Ollama, OpenAI, and Anthropic."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(chat.router,      prefix="/api/chat",     tags=["chat"])
app.include_router(documents.router, prefix="/api/documents", tags=["documents"])
app.include_router(rag.router,       prefix="/api/rag",       tags=["rag"])
app.include_router(search.router,    prefix="/api/search",    tags=["search"])
app.include_router(research.router,  prefix="/api/research",  tags=["research"])
app.include_router(models.router,    prefix="/api",           tags=["models"])
app.include_router(auth.router,  prefix="/api/auth",  tags=["auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])

# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/api/health", tags=["health"])
async def health():
    return {"status": "ok", "app": settings.app_name, "version": "0.1.0"}

# ── Global error handler ──────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all for unhandled exceptions — logs the traceback and returns a
    safe JSON error response instead of crashing the server."""
    log.error(
        "Unhandled exception on %s %s: %s",
        request.method,
        request.url.path,
        exc,
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": (
                "Internal server error. "
                "Check backend logs for details: `docker compose logs backend`"
            )
        },
    )
