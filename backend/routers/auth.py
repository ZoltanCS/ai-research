"""Authentication endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.dependencies import get_current_user, require_user
from core.security import create_access_token, hash_password, verify_password
from models.database import User
from models.schemas import TokenResponse, UserLogin, UserOut, UserPasswordChange, UserProfileUpdate, UserRegister

router = APIRouter()


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: UserRegister, db: AsyncSession = Depends(get_db)):
    # Check uniqueness
    existing = await db.execute(
        select(User).where((User.username == body.username) | (User.email == body.email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username or email already taken")

    # First user becomes admin
    count_result = await db.execute(select(func.count()).select_from(User))
    is_first = count_result.scalar() == 0

    user = User(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
        is_admin=is_first,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(require_user)):
    return UserOut.model_validate(user)


@router.patch("/profile", response_model=UserOut)
async def update_profile(
    body: UserProfileUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Update the current user's profile (display name, bio, avatar, email, username)."""
    if body.username is not None and body.username != user.username:
        existing = await db.execute(select(User).where(User.username == body.username))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Username already taken")
        user.username = body.username

    if body.email is not None and body.email != user.email:
        existing = await db.execute(select(User).where(User.email == body.email))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = body.email

    if body.display_name is not None:
        user.display_name = body.display_name or None
    if body.bio is not None:
        user.bio = body.bio or None
    if body.avatar_data is not None:
        user.avatar_data = body.avatar_data or None

    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.patch("/password", status_code=204)
async def change_password(
    body: UserPasswordChange,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    """Change the current user's password (requires existing password)."""
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.hashed_password = hash_password(body.new_password)
    await db.commit()
