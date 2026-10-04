import hashlib
import secrets
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Generator
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, root_validator, validator
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, JSON, String, create_engine
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


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    location = Column(String(160), nullable=False)
    stream_url = Column(String(1000), nullable=True)
    status = Column(String(20), nullable=False, default="disconnected")
    username = Column(String(255), nullable=True)
    password = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class Zone(Base):
    __tablename__ = "zones"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True)
    shape_type = Column(String(20), nullable=False)
    coordinates = Column(JSON, nullable=False)
    crowd_threshold = Column(Integer, nullable=False)
    confidence_threshold = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


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


def validate_stream_url(cls: type[BaseModel], value: str | None) -> str | None:
    if value is None:
        return value
    try:
        parsed = urlsplit(value)
    except ValueError as error:
        raise ValueError("Stream URL is invalid") from error
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Put camera credentials in the separate credential fields")
    return value.strip() or None


def trim_nonempty(cls: type[BaseModel], value: str | None) -> str | None:
    if value is None:
        return value
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("This field cannot be empty")
    return trimmed


class CameraCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    location: str = Field(..., min_length=1, max_length=160)
    stream_url: str | None = Field(default=None, max_length=1000)
    status: str = Field(default="disconnected", regex="^(connected|processing|disconnected)$")
    username: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, max_length=255)

    _trim_name = validator("name", allow_reuse=True)(trim_nonempty)
    _trim_location = validator("location", allow_reuse=True)(trim_nonempty)
    _validate_stream_url = validator("stream_url", allow_reuse=True)(validate_stream_url)


class CameraUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    location: str | None = Field(default=None, min_length=1, max_length=160)
    stream_url: str | None = Field(default=None, max_length=1000)
    status: str | None = Field(default=None, regex="^(connected|processing|disconnected)$")
    username: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, max_length=255)

    _trim_name = validator("name", allow_reuse=True)(trim_nonempty)
    _trim_location = validator("location", allow_reuse=True)(trim_nonempty)
    _validate_stream_url = validator("stream_url", allow_reuse=True)(validate_stream_url)


class CameraPublic(BaseModel):
    id: int
    name: str
    location: str
    stream_url: str | None
    status: str

    class Config:
        orm_mode = True


class ZoneShape(str, Enum):
    RECTANGLE = "rectangle"
    POLYGON = "polygon"


class ZoneFields(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    camera_id: int | None = None
    shape_type: ZoneShape
    coordinates: Any
    crowd_threshold: int = Field(..., ge=1, le=100_000)
    confidence_threshold: float = Field(..., ge=0, le=1)

    @validator("name")
    def validate_zone_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Zone name cannot be empty")
        return trimmed

    @root_validator
    def validate_coordinates(cls, values: dict[str, Any]) -> dict[str, Any]:
        shape_type = values.get("shape_type")
        coordinates = values.get("coordinates")
        if shape_type == ZoneShape.RECTANGLE:
            if not isinstance(coordinates, dict) or set(coordinates) != {"x", "y", "width", "height"}:
                raise ValueError("Rectangle coordinates must contain x, y, width, and height")
            x, y, width, height = (coordinates[key] for key in ("x", "y", "width", "height"))
            if any(not isinstance(value, (int, float)) for value in (x, y, width, height)):
                raise ValueError("Rectangle coordinates must be numbers")
            if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
                raise ValueError("Rectangle must fit within normalized 0-1 bounds with positive dimensions")
        elif shape_type == ZoneShape.POLYGON:
            if not isinstance(coordinates, list) or len(coordinates) < 3:
                raise ValueError("A polygon must contain at least three points")
            for point in coordinates:
                if not isinstance(point, dict) or set(point) != {"x", "y"}:
                    raise ValueError("Each polygon point must contain x and y")
                x, y = point["x"], point["y"]
                if (
                    not isinstance(x, (int, float))
                    or not isinstance(y, (int, float))
                    or not 0 <= x <= 1
                    or not 0 <= y <= 1
                ):
                    raise ValueError("Polygon points must be within normalized 0-1 bounds")
        return values


class ZoneCreate(ZoneFields):
    pass


class ZoneUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    camera_id: int | None = None
    shape_type: ZoneShape | None = None
    coordinates: Any = None
    crowd_threshold: int | None = Field(default=None, ge=1, le=100_000)
    confidence_threshold: float | None = Field(default=None, ge=0, le=1)


class ZonePublic(BaseModel):
    id: int
    name: str
    camera_id: int | None
    shape_type: str
    coordinates: Any
    crowd_threshold: int
    confidence_threshold: float

    class Config:
        orm_mode = True


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


def validate_zone_camera(db: Session, camera_id: int | None) -> None:
    if camera_id is not None and db.query(Camera).filter(Camera.id == camera_id).first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")


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


@app.get(f"{settings.api_v1_prefix}/cameras", response_model=list[CameraPublic])
def list_cameras(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Camera]:
    return db.query(Camera).order_by(Camera.id).all()


@app.post(f"{settings.api_v1_prefix}/cameras", response_model=CameraPublic, status_code=status.HTTP_201_CREATED)
def create_camera(
    payload: CameraCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Camera:
    camera = Camera(
        name=payload.name,
        location=payload.location,
        stream_url=payload.stream_url,
        status=payload.status,
        username=payload.username,
        password=payload.password,
    )
    db.add(camera)
    db.commit()
    db.refresh(camera)
    return camera


@app.patch(f"{settings.api_v1_prefix}/cameras/{{camera_id}}", response_model=CameraPublic)
def update_camera(
    camera_id: int,
    payload: CameraUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Camera:
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if camera is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")

    for field, value in payload.dict(exclude_unset=True).items():
        if field in {"name", "location", "status"} and value is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{field} cannot be null")
        setattr(camera, field, value)
    db.commit()
    db.refresh(camera)
    return camera


@app.delete(f"{settings.api_v1_prefix}/cameras/{{camera_id}}", status_code=status.HTTP_204_NO_CONTENT)
def delete_camera(
    camera_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if camera is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    db.query(Zone).filter(Zone.camera_id == camera_id).update({"camera_id": None})
    db.delete(camera)
    db.commit()


@app.get(f"{settings.api_v1_prefix}/zones", response_model=list[ZonePublic])
def list_zones(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Zone]:
    return db.query(Zone).order_by(Zone.id).all()


@app.post(f"{settings.api_v1_prefix}/zones", response_model=ZonePublic, status_code=status.HTTP_201_CREATED)
def create_zone(
    payload: ZoneCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Zone:
    validate_zone_camera(db, payload.camera_id)
    zone = Zone(
        name=payload.name,
        camera_id=payload.camera_id,
        shape_type=payload.shape_type.value,
        coordinates=payload.coordinates,
        crowd_threshold=payload.crowd_threshold,
        confidence_threshold=payload.confidence_threshold,
    )
    db.add(zone)
    db.commit()
    db.refresh(zone)
    return zone


@app.patch(f"{settings.api_v1_prefix}/zones/{{zone_id}}", response_model=ZonePublic)
def update_zone(
    zone_id: int,
    payload: ZoneUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Zone:
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if zone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zone not found")

    merged_values = {
        "name": zone.name,
        "camera_id": zone.camera_id,
        "shape_type": zone.shape_type,
        "coordinates": zone.coordinates,
        "crowd_threshold": zone.crowd_threshold,
        "confidence_threshold": zone.confidence_threshold,
        **payload.dict(exclude_unset=True),
    }
    validated = ZoneCreate(**merged_values)
    validate_zone_camera(db, validated.camera_id)
    zone.name = validated.name
    zone.camera_id = validated.camera_id
    zone.shape_type = validated.shape_type.value
    zone.coordinates = validated.coordinates
    zone.crowd_threshold = validated.crowd_threshold
    zone.confidence_threshold = validated.confidence_threshold
    db.commit()
    db.refresh(zone)
    return zone


@app.delete(f"{settings.api_v1_prefix}/zones/{{zone_id}}", status_code=status.HTTP_204_NO_CONTENT)
def delete_zone(
    zone_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if zone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zone not found")
    db.delete(zone)
    db.commit()


@app.get(f"{settings.api_v1_prefix}/auth/safety-check")
def safety_access_check(current_user: User = Depends(require_roles([UserRole.SAFETY_OFFICER.value, UserRole.ADMINISTRATOR.value]))) -> dict[str, str]:
    return {"status": "ok", "role": current_user.role, "message": "Safety access confirmed"}


@app.get(f"{settings.api_v1_prefix}/auth/admin-check")
def admin_access_check(current_user: User = Depends(require_roles([UserRole.ADMINISTRATOR.value]))) -> dict[str, str]:
    return {"status": "ok", "role": current_user.role, "message": "Admin access confirmed"}
