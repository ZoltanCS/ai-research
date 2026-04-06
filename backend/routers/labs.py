"""Labs router — agentic workspace with file system and code execution tools."""

import asyncio
import json
import logging
import os
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.ai_provider import ProviderCredentials, stream_chat_with_file_tools

log = logging.getLogger(__name__)
router = APIRouter()

# ── Workspace ──────────────────────────────────────────────────────────────────
# Each workspace lives at /workspace inside the container. Create on startup.

WORKSPACE_ROOT = Path("/workspace")
WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)


def _safe_path(relative: str) -> Path:
    """Resolve relative path, raising 400 if it escapes the workspace."""
    clean = Path(relative).as_posix().lstrip("/")
    resolved = (WORKSPACE_ROOT / clean).resolve()
    if not str(resolved).startswith(str(WORKSPACE_ROOT.resolve())):
        raise HTTPException(400, "Path escapes workspace root")
    return resolved


def _node(p: Path, root: Path) -> dict:
    """Recursively build a file-tree node."""
    if p.is_dir():
        children = sorted(
            [_node(c, root) for c in p.iterdir()],
            key=lambda x: (x["type"] == "file", x["name"]),
        )
        return {"type": "directory", "name": p.name, "path": str(p.relative_to(root)), "children": children}
    return {"type": "file", "name": p.name, "path": str(p.relative_to(root)), "size": p.stat().st_size}


# ── File CRUD ─────────────────────────────────────────────────────────────────

@router.get("/files")
async def list_files():
    if not WORKSPACE_ROOT.exists():
        WORKSPACE_ROOT.mkdir(parents=True)
    root_node = _node(WORKSPACE_ROOT, WORKSPACE_ROOT)
    return {"files": root_node.get("children", [])}


@router.get("/files/{path:path}")
async def read_file(path: str):
    p = _safe_path(path)
    if not p.exists():
        raise HTTPException(404, f"Not found: {path}")
    if p.is_dir():
        raise HTTPException(400, "Path is a directory")
    return {"path": path, "content": p.read_text(encoding="utf-8", errors="replace")}


class WriteRequest(BaseModel):
    path: str
    content: str


@router.post("/files")
async def write_file(req: WriteRequest):
    p = _safe_path(req.path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(req.content, encoding="utf-8")
    return {"path": req.path, "size": p.stat().st_size}


class RenameRequest(BaseModel):
    old_path: str
    new_path: str


@router.put("/files")
async def rename_file(req: RenameRequest):
    src = _safe_path(req.old_path)
    dst = _safe_path(req.new_path)
    if not src.exists():
        raise HTTPException(404, f"Not found: {req.old_path}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
    return {"old_path": req.old_path, "new_path": req.new_path}


@router.delete("/files/{path:path}")
async def delete_file(path: str):
    p = _safe_path(path)
    if not p.exists():
        raise HTTPException(404, f"Not found: {path}")
    if p.is_dir():
        shutil.rmtree(p)
    else:
        p.unlink()
    return {"deleted": path}


# ── Code execution ───────────────────────────────────────────────────────────

class ExecuteRequest(BaseModel):
    code: str
    language: str = "python"


def _ext(lang: str) -> str:
    return {"python": ".py", "javascript": ".js", "bash": ".sh"}.get(lang, ".txt")


def _cmd(lang: str, path: str) -> list[str]:
    return {
        "python": ["python3", path],
        "javascript": ["node", path],
        "bash": ["bash", path],
    }.get(lang, ["cat", path])


@router.post("/execute")
async def execute_code(req: ExecuteRequest):
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=_ext(req.language), delete=False, encoding="utf-8"
    ) as f:
        f.write(req.code)
        tmpfile = f.name
    try:
        proc = await asyncio.create_subprocess_exec(
            *_cmd(req.language, tmpfile),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(WORKSPACE_ROOT),
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        except asyncio.TimeoutError:
            proc.kill()
            return {"stdout": "", "stderr": "Timed out after 30s", "exit_code": -1}
        return {
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
            "exit_code": proc.returncode,
        }
    finally:
        try:
            os.unlink(tmpfile)
        except OSError:
            pass


# ── Agentic chat streaming ───────────────────────────────────────────────────

class LabsMessage(BaseModel):
    role: str
    content: str


class LabsChatRequest(BaseModel):
    messages: list[LabsMessage]
    model: str
    provider: str
    system_prompt: str | None = None


def _creds(request: Request) -> ProviderCredentials:
    h = request.headers
    return ProviderCredentials(
        openai_key=h.get("X-OpenAI-Key", ""),
        anthropic_key=h.get("X-Anthropic-Key", ""),
        cerebras_key=h.get("X-Cerebras-Key", ""),
        vercel_token=h.get("X-Vercel-Token", ""),
        vercel_gateway_url=h.get("X-Vercel-Gateway", ""),
        ollama_host=h.get("X-Ollama-Host", ""),
        tavily_key=h.get("X-Tavily-Key", ""),
        exa_key=h.get("X-Exa-Key", ""),
    )


@router.post("/chat/stream")
async def labs_chat_stream(req: LabsChatRequest, http_request: Request):
    """Agentic chat that can create, read, edit, delete files and execute code."""
    creds = _creds(http_request)
    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    async def event_stream():
        try:
            async for chunk in stream_chat_with_file_tools(
                messages=messages,
                model=req.model,
                provider=req.provider,
                system_prompt=req.system_prompt,
                creds=creds,
                workspace_root=WORKSPACE_ROOT,
            ):
                if isinstance(chunk, str):
                    yield f"data: {json.dumps({'delta': chunk})}\n\n"
                elif isinstance(chunk, dict):
                    yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            log.error("Labs chat error: %s", e, exc_info=True)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
