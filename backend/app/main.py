import hashlib
import secrets
from datetime import datetime, timezone
from enum import Enum
from typing import Generator

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.core.config import settings

Base = declarative_base()

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
security = HTTPBearer(auto_error=False)


class UserRole(str, Enum):
    SAFETY_OFFICER = "safety_officer"
    ADMINISTRATOR = "administrator"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(120), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(40), nullable=False, default=UserRole.SAFETY_OFFICER.value)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class SessionToken(Base):
    __tablename__ = "session_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token_hash = Column(String(255), unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    email = Column(String(255), nullable=False)
    role = Column(String(40), nullable=False)
    action = Column(String(40), nullable=False, default="login")
    logged_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class RegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., min_length=4, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    role: UserRole = UserRole.SAFETY_OFFICER


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=4, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)


class UserPublic(BaseModel):
    id: int
    full_name: str
    email: str
    role: str


Base.metadata.create_all(bind=engine)


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    password_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"{salt}${password_hash.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, expected = stored_hash.split("$", 1)
    except ValueError:
        return False
    password_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return password_hash.hex() == expected


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    session = db.query(SessionToken).filter(SessionToken.token_hash == hash_token(credentials.credentials)).first()
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")

    user = db.query(User).filter(User.id == session.user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user


def require_roles(allowed_roles: list[str]):
    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return dependency


@app.get(f"{settings.api_v1_prefix}/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "AI Industrial Safety Copilot backend is running."}


@app.post(f"{settings.api_v1_prefix}/auth/register", response_model=UserPublic)
def register_user(payload: RegisterRequest, db: Session = Depends(get_db)) -> UserPublic:
    email = payload.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Account already exists")

    user = User(
        full_name=payload.full_name.strip(),
        email=email,
        password_hash=hash_password(payload.password),
        role=payload.role.value,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return UserPublic(id=user.id, full_name=user.full_name, email=user.email, role=user.role)


@app.post(f"{settings.api_v1_prefix}/auth/login")
def login_user(payload: LoginRequest, db: Session = Depends(get_db)) -> dict[str, object]:
    email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = secrets.token_urlsafe(32)
    db.query(SessionToken).filter(SessionToken.user_id == user.id).delete()
    db.add(SessionToken(user_id=user.id, token_hash=hash_token(token)))
    db.add(
        AuditLog(
            user_id=user.id,
            email=user.email,
            role=user.role,
            action="login",
        )
    )
    db.commit()

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": UserPublic(id=user.id, full_name=user.full_name, email=user.email, role=user.role).dict(),
    }


@app.post(f"{settings.api_v1_prefix}/auth/logout")
def logout_user(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    db.query(SessionToken).filter(SessionToken.user_id == current_user.id).delete()
    db.commit()
    return {"message": "Logged out successfully"}


@app.get(f"{settings.api_v1_prefix}/auth/me", response_model=UserPublic)
def get_current_user_profile(current_user: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic(id=current_user.id, full_name=current_user.full_name, email=current_user.email, role=current_user.role)


@app.get(f"{settings.api_v1_prefix}/auth/safety-check")
def safety_access_check(current_user: User = Depends(require_roles([UserRole.SAFETY_OFFICER.value, UserRole.ADMINISTRATOR.value]))) -> dict[str, str]:
    return {"status": "ok", "role": current_user.role, "message": "Safety access confirmed"}


@app.get(f"{settings.api_v1_prefix}/auth/admin-check")
def admin_access_check(current_user: User = Depends(require_roles([UserRole.ADMINISTRATOR.value]))) -> dict[str, str]:
    return {"status": "ok", "role": current_user.role, "message": "Admin access confirmed"}
