"""Admin-only endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.dependencies import require_admin
from models.database import GlobalSettings, User
from models.schemas import GlobalSettingsOut, GlobalSettingsUpdate

router = APIRouter()

_KEYS = [
    "openai_api_key",
    "anthropic_api_key",
    "cerebras_api_key",
    "vercel_api_token",
    "vercel_gateway_url",
    "ollama_host",
]


async def _load(db: AsyncSession) -> dict[str, str]:
    rows = await db.execute(select(GlobalSettings))
    return {r.key: r.value for r in rows.scalars()}


@router.get("/settings", response_model=GlobalSettingsOut)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    data = await _load(db)
    return GlobalSettingsOut(**{k: data.get(k, "") for k in _KEYS})


@router.put("/settings", response_model=GlobalSettingsOut)
async def update_settings(
    body: GlobalSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    for key in _KEYS:
        value = getattr(body, key, "")
        existing = await db.get(GlobalSettings, key)
        if existing:
            existing.value = value
        else:
            db.add(GlobalSettings(key=key, value=value))
    await db.commit()
    data = await _load(db)
    return GlobalSettingsOut(**{k: data.get(k, "") for k in _KEYS})
