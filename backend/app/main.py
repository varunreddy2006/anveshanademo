import hashlib
import csv
import io
import logging
import secrets
import threading
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Generator, Literal
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, root_validator, validator
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String, create_engine, func, or_
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.types import TypeDecorator

from app.core.config import settings
from app import vision
from app.risk import RiskWeights, project_score, regression_slope, risk_explanation, risk_trend, score_events

Base = declarative_base()


class UTCDateTime(TypeDecorator[datetime]):
    impl = DateTime
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(DateTime(timezone=dialect.name != "sqlite"))

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        normalized = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        if dialect.name == "sqlite":
            return normalized.replace(tzinfo=None)
        return normalized

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def serialize_utc_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    normalized = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return normalized.isoformat().replace("+00:00", "Z")


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
    created_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc), nullable=False)


class SessionToken(Base):
    __tablename__ = "session_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token_hash = Column(String(255), unique=True, nullable=False)
    created_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc), nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    email = Column(String(255), nullable=False)
    role = Column(String(40), nullable=False)
    action = Column(String(40), nullable=False, default="login")
    details = Column(String(500), nullable=True)
    logged_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc), nullable=False)


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    location = Column(String(160), nullable=False)
    stream_url = Column(String(1000), nullable=True)
    status = Column(String(20), nullable=False, default="disconnected")
    username = Column(String(255), nullable=True)
    password = Column(String(255), nullable=True)
    created_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc), nullable=False)


class Zone(Base):
    __tablename__ = "zones"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True)
    zone_type = Column(String(32), nullable=False, default="normal", server_default="normal")
    shape_type = Column(String(20), nullable=False)
    coordinates = Column(JSON, nullable=False)
    crowd_threshold = Column(Integer, nullable=False)
    confidence_threshold = Column(Float, nullable=False)
    created_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc), nullable=False)


class DetectionEvent(Base):
    __tablename__ = "detection_events"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True)
    zone_id = Column(Integer, ForeignKey("zones.id", ondelete="SET NULL"), nullable=True)
    event_type = Column(String(80), nullable=False)
    zone_name = Column(String(120), nullable=False)
    detail = Column(String(500), nullable=False)
    evidence_filename = Column(String(255), nullable=False)
    frame_index = Column(Integer, nullable=False)
    created_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc), nullable=False)


class RiskScoreHistory(Base):
    __tablename__ = "risk_score_history"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, ForeignKey("zones.id", ondelete="CASCADE"), nullable=False, index=True)
    score = Column(Integer, nullable=False)
    trend = Column(String(20), nullable=False)
    velocity = Column(Float, nullable=False)
    projected_score = Column(Integer, nullable=False)
    explanation = Column(String(500), nullable=False)
    is_simulated = Column(Boolean, nullable=False, default=False, server_default="0")
    recorded_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)


class SafetyAlert(Base):
    __tablename__ = "safety_alerts"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("detection_events.id", ondelete="CASCADE"), unique=True, nullable=False)
    status = Column(String(30), nullable=False, default="New", server_default="New")
    assigned_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc), nullable=False)


class AlertNote(Base):
    __tablename__ = "alert_notes"

    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(Integer, ForeignKey("safety_alerts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    note = Column(String(2000), nullable=False)
    created_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc), nullable=False)


class RegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., min_length=4, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    role: UserRole = UserRole.SAFETY_OFFICER


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=4, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)


class AlertUpdate(BaseModel):
    status: str | None = Field(default=None, regex="^(New|Acknowledged|Under Investigation|Resolved|False Positive)$")
    assigned_user_id: int | None = None

    @root_validator(pre=True)
    def require_alert_change(cls, values: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(values, dict) or not ({"status", "assigned_user_id"} & values.keys()):
            raise ValueError("Provide a status or assignment change")
        return values


class AlertNoteCreate(BaseModel):
    note: str = Field(..., min_length=1, max_length=2000)

    @validator("note")
    def trim_note(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Note cannot be empty")
        return value


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


class ZoneType(str, Enum):
    NORMAL = "normal"
    RESTRICTED = "restricted"
    HAZARD_MACHINERY = "hazard_machinery"


class ZoneFields(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    camera_id: int | None = None
    zone_type: ZoneType = ZoneType.NORMAL
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
    zone_type: ZoneType | None = None
    shape_type: ZoneShape | None = None
    coordinates: Any = None
    crowd_threshold: int | None = Field(default=None, ge=1, le=100_000)
    confidence_threshold: float | None = Field(default=None, ge=0, le=1)


class VisionStartRequest(BaseModel):
    source: str = Field(default="stream", regex="^(webcam|stream)$")
    stream_url: str | None = Field(default=None, max_length=1000)


class ZonePublic(BaseModel):
    id: int
    name: str
    camera_id: int | None
    zone_type: str = "normal"
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

vision_event_store_lock = threading.RLock()


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
        zone_type=payload.zone_type.value,
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
        "zone_type": zone.zone_type or ZoneType.NORMAL.value,
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
    zone.zone_type = validated.zone_type.value
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


def vision_zones(db: Session, camera_id: int) -> list[dict[str, Any]]:
    return [
        {
            "id": zone.id,
            "name": zone.name,
            "camera_id": zone.camera_id,
            "zone_type": zone.zone_type or ZoneType.NORMAL.value,
            "shape_type": zone.shape_type,
            "coordinates": zone.coordinates,
            "crowd_threshold": zone.crowd_threshold,
            "confidence_threshold": zone.confidence_threshold,
        }
        for zone in db.query(Zone).filter((Zone.camera_id == camera_id) | (Zone.camera_id.is_(None))).all()
    ]


def persist_vision_event(
    camera_id: int,
    event_type: str,
    zone_name: str,
    detail: str,
    evidence: bytes,
    frame_index: int,
    zone_id: int | None = None,
) -> None:
    with vision_event_store_lock:
        db = SessionLocal()
        evidence_filename = vision.save_evidence(evidence)
        try:
            event = DetectionEvent(
                camera_id=camera_id,
                zone_id=zone_id,
                event_type=event_type,
                zone_name=zone_name,
                detail=detail,
                evidence_filename=evidence_filename,
                frame_index=frame_index,
            )
            db.add(event)
            db.flush()
            db.add(SafetyAlert(event_id=event.id))
            db.commit()
        except Exception:
            db.rollback()
            vision.get_evidence_path(evidence_filename).unlink(missing_ok=True)
            raise
        finally:
            db.close()


def configured_risk_weights() -> RiskWeights:
    return RiskWeights(
        restricted_entry=settings.risk_weight_restricted_entry,
        hazard_proximity=settings.risk_weight_hazard_proximity,
        crowding=settings.risk_weight_crowding,
    )


def zone_detection_events(db: Session, zone: Zone, all_zones: list[Zone]) -> list[DetectionEvent]:
    matching_legacy_zones = [
        candidate
        for candidate in all_zones
        if candidate.name == zone.name
        and (candidate.camera_id is None or zone.camera_id is None or candidate.camera_id == zone.camera_id)
    ]
    legacy_is_unambiguous = len(matching_legacy_zones) == 1
    events = db.query(DetectionEvent).all()
    return [
        event
        for event in events
        if event.zone_id == zone.id
        or (
            legacy_is_unambiguous
            and event.zone_id is None
            and event.zone_name == zone.name
            and (zone.camera_id is None or event.camera_id == zone.camera_id)
        )
    ]


def calculate_zone_risk(
    db: Session,
    zone: Zone,
    all_zones: list[Zone],
    now: datetime,
) -> dict[str, Any]:
    current_time = now.astimezone(timezone.utc) if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    events = zone_detection_events(db, zone, all_zones)
    weights = configured_risk_weights()
    event_values = [{"event_type": event.event_type, "created_at": event.created_at} for event in events]
    score = score_events(
        event_values,
        current_time,
        weights,
        settings.risk_decay_half_life_minutes,
    )
    cutoff = current_time - timedelta(minutes=5)
    earlier_events = [event for event in event_values if event["created_at"] <= cutoff]
    score_five_minutes_ago = score_events(
        earlier_events,
        cutoff,
        weights,
        settings.risk_decay_half_life_minutes,
    )
    recent_events = [event for event in event_values if event["created_at"] >= cutoff]
    samples = [
        (entry.recorded_at, float(entry.score))
        for entry in (
            db.query(RiskScoreHistory)
            .filter(
                RiskScoreHistory.zone_id == zone.id,
                RiskScoreHistory.is_simulated.is_(False),
                RiskScoreHistory.recorded_at >= current_time - timedelta(minutes=15),
                RiskScoreHistory.recorded_at <= current_time,
            )
            .order_by(RiskScoreHistory.recorded_at)
            .all()
        )
    ]
    velocity = regression_slope(samples, now=current_time, window_minutes=15)
    trend = risk_trend(velocity)
    return {
        "score": score,
        "trend": trend,
        "velocity": velocity,
        "rapid_escalation": velocity >= settings.risk_rapid_escalation_velocity,
        "projected_score": project_score(score, velocity),
        "explanation": risk_explanation(score, score_five_minutes_ago, recent_events),
        "updated_at": serialize_utc_datetime(current_time),
    }


def risk_period_bounds(period: Literal["hour", "today", "7d"], now: datetime) -> tuple[datetime, datetime]:
    current_time = now.astimezone(timezone.utc) if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    if period == "hour":
        start = current_time - timedelta(hours=1)
    elif period == "today":
        start = current_time.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        start = current_time - timedelta(days=7)
    duration = current_time - start
    return start, start - duration


def zone_period_analytics(
    events: list[DetectionEvent],
    *,
    start: datetime,
    previous_start: datetime,
    now: datetime,
    weights: RiskWeights,
    half_life_minutes: float,
) -> dict[str, Any]:
    previous_end = start
    current_events = [event for event in events if start <= event.created_at <= now]
    previous_events = [event for event in events if previous_start <= event.created_at < previous_end]
    score_for = lambda selected, evaluated_at: score_events(
        (
            {"event_type": event.event_type, "created_at": event.created_at}
            for event in selected
        ),
        evaluated_at,
        weights,
        half_life_minutes,
    )
    current_score = score_for(current_events, now)
    previous_score = score_for(previous_events, previous_end)
    counts = Counter(event.event_type for event in current_events)
    recommendations = {
        "Restricted-zone entry": "Review access controls and reinforce restricted-zone procedures.",
        "Hazard-zone proximity": "Inspect machinery guarding and verify the hazard exclusion distance.",
        "Crowding threshold": "Review occupancy limits and consider staggering personnel in this zone.",
    }
    categories = [
        {"event_type": event_type, "count": count}
        for event_type, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]
    most_frequent_count = max(counts.values(), default=0)
    actions = [
        {
            "event_type": category["event_type"],
            "count": category["count"],
            "action": recommendations[category["event_type"]],
        }
        for category in categories
        if category["event_type"] in recommendations and category["count"] == most_frequent_count
    ]
    return {
        "period_event_count": len(current_events),
        "event_categories": categories,
        "recommendations": actions,
        "period_score": current_score,
        "previous_period_score": previous_score,
        "period_score_change": current_score - previous_score,
    }


def store_zone_risk_sample(db: Session, zone: Zone, all_zones: list[Zone], now: datetime) -> RiskScoreHistory:
    result = calculate_zone_risk(db, zone, all_zones, now)
    history = RiskScoreHistory(
        zone_id=zone.id,
        score=result["score"],
        trend=result["trend"],
        velocity=result["velocity"],
        projected_score=result["projected_score"],
        explanation=result["explanation"],
        is_simulated=False,
        recorded_at=now,
    )
    db.add(history)
    return history


risk_scheduler_stop = threading.Event()
risk_scheduler_thread: threading.Thread | None = None


def risk_history_scheduler() -> None:
    while not risk_scheduler_stop.wait(5):
        active_camera_ids = vision.active_camera_ids()
        db = SessionLocal()
        try:
            with vision_event_store_lock:
                zones = db.query(Zone).all()
                now = datetime.now(timezone.utc)
                if active_camera_ids:
                    zones_to_update = [
                        zone for zone in zones
                        if zone.camera_id is None or zone.camera_id in active_camera_ids
                    ]
                else:
                    zones_to_update = [
                        zone
                        for zone in zones
                        if calculate_zone_risk(db, zone, zones, now)["score"] > 0
                    ]
                for zone in zones_to_update:
                    store_zone_risk_sample(db, zone, zones, now)
                if zones_to_update:
                    db.commit()
        except Exception:
            db.rollback()
            logging.getLogger(__name__).exception("Unable to update zone risk history")
        finally:
            db.close()


@app.on_event("startup")
def start_risk_history_scheduler() -> None:
    global risk_scheduler_thread
    risk_scheduler_stop.clear()
    if risk_scheduler_thread is None or not risk_scheduler_thread.is_alive():
        risk_scheduler_thread = threading.Thread(
            target=risk_history_scheduler,
            name="risk-history-scheduler",
            daemon=True,
        )
        risk_scheduler_thread.start()


@app.on_event("shutdown")
def stop_risk_history_scheduler() -> None:
    risk_scheduler_stop.set()
    if risk_scheduler_thread is not None:
        risk_scheduler_thread.join(timeout=6)


def risk_history_payload(entry: RiskScoreHistory) -> dict[str, Any]:
    return {
        "score": entry.score,
        "trend": entry.trend,
        "velocity": entry.velocity,
        "projected_score": entry.projected_score,
        "explanation": entry.explanation,
        "is_simulated": entry.is_simulated,
        "recorded_at": serialize_utc_datetime(entry.recorded_at),
    }


@app.get(f"{settings.api_v1_prefix}/risk/config")
def get_risk_config(current_user: User = Depends(get_current_user)) -> dict[str, Any]:
    weights = configured_risk_weights()
    return {
        "weights": {
            "restricted_entry": weights.restricted_entry,
            "hazard_proximity": weights.hazard_proximity,
            "crowding": weights.crowding,
        },
        "decay_half_life_minutes": settings.risk_decay_half_life_minutes,
        "rapid_escalation_velocity": settings.risk_rapid_escalation_velocity,
        "trend_window_minutes": 15,
        "bands": {
            "low_max": settings.risk_band_low_max,
            "guarded_max": settings.risk_band_guarded_max,
            "elevated_max": settings.risk_band_elevated_max,
        },
    }


@app.get(f"{settings.api_v1_prefix}/risk/zones")
def list_zone_risk(
    period: Literal["hour", "today", "7d"] = Query(default="hour"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    zones = db.query(Zone).order_by(Zone.id).all()
    now = datetime.now(timezone.utc)
    period_start, previous_period_start = risk_period_bounds(period, now)
    weights = configured_risk_weights()
    results = []
    for zone in zones:
        zone_events = zone_detection_events(db, zone, zones)
        real_history = (
            db.query(RiskScoreHistory)
            .filter(
                RiskScoreHistory.zone_id == zone.id,
                RiskScoreHistory.is_simulated.is_(False),
                RiskScoreHistory.recorded_at >= period_start,
                RiskScoreHistory.recorded_at <= now,
            )
            .order_by(RiskScoreHistory.recorded_at.desc())
            .limit(500)
            .all()
        )
        simulated_history = (
            db.query(RiskScoreHistory)
            .filter(
                RiskScoreHistory.zone_id == zone.id,
                RiskScoreHistory.is_simulated.is_(True),
                RiskScoreHistory.recorded_at >= period_start,
                RiskScoreHistory.recorded_at <= now,
            )
            .order_by(RiskScoreHistory.recorded_at.desc())
            .limit(500)
            .all()
        )
        history = sorted(real_history + simulated_history, key=lambda entry: entry.recorded_at)
        latest_simulated = max(simulated_history, key=lambda entry: entry.recorded_at, default=None)
        simulated_demo = (
            {
                "score": latest_simulated.score,
                "trend": latest_simulated.trend,
                "velocity": latest_simulated.velocity,
                "rapid_escalation": latest_simulated.velocity >= settings.risk_rapid_escalation_velocity,
                "projected_score": latest_simulated.projected_score,
                "explanation": latest_simulated.explanation,
                "updated_at": serialize_utc_datetime(latest_simulated.recorded_at),
            }
            if latest_simulated is not None
            else None
        )
        results.append(
            {
                "zone_id": zone.id,
                "zone_name": zone.name,
                "zone_type": zone.zone_type or ZoneType.NORMAL.value,
                **calculate_zone_risk(db, zone, zones, now),
                **zone_period_analytics(
                    zone_events,
                    start=period_start,
                    previous_start=previous_period_start,
                    now=now,
                    weights=weights,
                    half_life_minutes=settings.risk_decay_half_life_minutes,
                ),
                "period_start": serialize_utc_datetime(period_start),
                "period": period,
                "simulated_demo": simulated_demo,
                "history": [risk_history_payload(entry) for entry in history],
            }
        )
    return results


@app.post(f"{settings.api_v1_prefix}/risk/simulated-history")
def seed_simulated_risk_history(
    current_user: User = Depends(
        require_roles([UserRole.ADMINISTRATOR.value, UserRole.SAFETY_OFFICER.value])
    ),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    db.query(RiskScoreHistory).filter(RiskScoreHistory.is_simulated.is_(True)).delete(synchronize_session=False)
    zones = db.query(Zone).order_by(Zone.id).all()
    now = datetime.now(timezone.utc)
    for zone_index, zone in enumerate(zones):
        previous_score: int | None = None
        for point_index in range(12):
            recorded_at = now - timedelta(minutes=11 - point_index)
            if zone_index == 0:
                score = 30 + point_index * 5
                explanation = (
                    "SIMULATED demo: Risk increased by 25 points in the last 5 minutes "
                    "due to 2 simulated restricted-zone entries."
                )
            elif zone_index == 1:
                score = point_index * 9
                explanation = (
                    "SIMULATED demo: Risk is escalating rapidly due to simulated hazard-proximity events."
                )
            elif zone_index == 2:
                score = 20
                explanation = "SIMULATED demo: Risk remained stable in the green band with no simulated events."
            else:
                score = 20
                explanation = f"SIMULATED demo: Risk remained stable in the green band for {zone.name}."
            velocity = round((score - previous_score), 2) if previous_score is not None else 0.0
            db.add(
                RiskScoreHistory(
                    zone_id=zone.id,
                    score=score,
                    trend=risk_trend(velocity),
                    velocity=velocity,
                    projected_score=project_score(score, velocity),
                    explanation=explanation,
                    is_simulated=True,
                    recorded_at=recorded_at,
                )
            )
            previous_score = score
    db.commit()
    return {"zones_seeded": len(zones), "samples_created": len(zones) * 12}


@app.delete(f"{settings.api_v1_prefix}/risk/simulated-history")
def clear_simulated_risk_history(
    current_user: User = Depends(
        require_roles([UserRole.ADMINISTRATOR.value, UserRole.SAFETY_OFFICER.value])
    ),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    deleted = (
        db.query(RiskScoreHistory)
        .filter(RiskScoreHistory.is_simulated.is_(True))
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"samples_deleted": deleted}


def report_period_bounds(period: str, report_date: date) -> tuple[datetime, datetime]:
    start_date = report_date
    if period == "week":
        start_date = report_date - timedelta(days=report_date.weekday())
        end_date = start_date + timedelta(days=7)
    elif period == "month":
        start_date = report_date.replace(day=1)
        end_date = (start_date.replace(day=28) + timedelta(days=4)).replace(day=1)
    elif period == "day":
        end_date = start_date + timedelta(days=1)
    else:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Period must be day, week, or month")
    return (
        datetime.combine(start_date, datetime.min.time(), timezone.utc),
        datetime.combine(end_date, datetime.min.time(), timezone.utc),
    )


def report_data(db: Session, start: datetime, end: datetime) -> dict[str, Any]:
    period_events = db.query(DetectionEvent).filter(
        DetectionEvent.created_at >= start,
        DetectionEvent.created_at < end,
    )
    by_type = [
        {"name": event_type, "count": count}
        for event_type, count in (
            period_events.with_entities(DetectionEvent.event_type, func.count(DetectionEvent.id))
            .group_by(DetectionEvent.event_type)
            .order_by(DetectionEvent.event_type)
            .all()
        )
    ]
    by_zone = [
        {"name": zone_name, "count": count}
        for zone_name, count in (
            period_events.with_entities(DetectionEvent.zone_name, func.count(DetectionEvent.id))
            .group_by(DetectionEvent.zone_name)
            .order_by(DetectionEvent.zone_name)
            .all()
        )
    ]
    zones = db.query(Zone).order_by(Zone.name).all()
    now = datetime.now(timezone.utc)
    zone_risks = [
        {
            "zone_id": zone.id,
            "zone_name": zone.name,
            **calculate_zone_risk(db, zone, zones, now),
        }
        for zone in zones
    ]
    includes_simulated = (
        db.query(RiskScoreHistory.id)
        .filter(RiskScoreHistory.is_simulated.is_(True))
        .first()
        is not None
    )
    return {
        "start": serialize_utc_datetime(start),
        "end": serialize_utc_datetime(end),
        "total_incidents": period_events.count(),
        "by_type": by_type,
        "by_zone": by_zone,
        "zone_risks": zone_risks,
        "includes_simulated": includes_simulated,
    }


@app.get(f"{settings.api_v1_prefix}/reports/summary")
def get_report_summary(
    start: datetime,
    end: datetime,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if end <= start:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Report end must be after start")
    return report_data(db, start, end)


@app.get(f"{settings.api_v1_prefix}/reports/pdf")
def download_pdf_report(
    period: str = Query(default="day"),
    report_date: date | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    if period not in {"day", "week", "month"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Period must be day, week, or month")
    report_date = report_date or datetime.now(timezone.utc).date()
    if (start is None) != (end is None):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Provide both report start and end")
    if start is None or end is None:
        start, end = report_period_bounds(period, report_date)
    elif end <= start:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Report end must be after start")
    data = report_data(db, start, end)
    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=0.65 * inch,
        leftMargin=0.65 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        title="Industrial Safety Incident Report",
    )
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="ReportNote", parent=styles["BodyText"], alignment=TA_LEFT, textColor=colors.HexColor("#334155")))
    elements = [
        Paragraph("Industrial Safety Incident Report", styles["Title"]),
        Paragraph(
            f"{period.title()} report · {start.date().isoformat()} through {(end - timedelta(days=1)).date().isoformat()}",
            styles["BodyText"],
        ),
        Spacer(1, 12),
        Paragraph(f"Total incidents: <b>{data['total_incidents']}</b>", styles["Heading2"]),
    ]
    if data["includes_simulated"]:
        elements.extend(
            [
                Spacer(1, 6),
                Paragraph("<b>Includes SIMULATED data</b> in the risk history charts. Simulated history is separate from real incidents.", styles["ReportNote"]),
            ]
        )

    def append_table(title: str, headers: list[str], rows: list[list[str]]) -> None:
        elements.extend([Spacer(1, 12), Paragraph(title, styles["Heading2"])])
        table_rows = [headers, *rows] if rows else [headers, ["No data", *("" for _ in headers[1:])]]
        table = Table(table_rows, repeatRows=1, hAlign="LEFT")
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
                ]
            )
        )
        elements.append(table)

    append_table("Incidents by event type", ["Event type", "Count"], [[row["name"], str(row["count"])] for row in data["by_type"]])
    append_table("Incidents by zone", ["Zone", "Count"], [[row["name"], str(row["count"])] for row in data["by_zone"]])
    append_table(
        "Current zone risk scores",
        ["Zone", "Score", "Trend"],
        [[row["zone_name"], f"{row['score']}/100", row["trend"]] for row in data["zone_risks"]],
    )
    elements.extend(
        [
            Spacer(1, 18),
            Paragraph(
                "Risk scores are calculated indicators and are not validated predictions. AI detections may be incorrect and require human review.",
                styles["ReportNote"],
            ),
        ]
    )
    document.build(elements)
    from fastapi.responses import Response

    return Response(
        content=buffer.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="safety-report-{period}-{report_date.isoformat()}.pdf"'},
    )


@app.get(f"{settings.api_v1_prefix}/vision/models")
def get_vision_models(
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    return vision.adapter_status()


@app.post(f"{settings.api_v1_prefix}/cameras/{{camera_id}}/vision/start")
def start_camera_vision(
    camera_id: int,
    payload: VisionStartRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if camera is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")

    stream_url = payload.stream_url or camera.stream_url
    if payload.source == "stream":
        if not stream_url:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Add a stream URL to this camera first")
        try:
            parsed = urlsplit(stream_url)
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Stream URL is invalid") from error
        if parsed.scheme not in {"rtsp", "rtsps", "http", "https"} or parsed.username is not None or parsed.password is not None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Use an RTSP/HTTP(S) URL without embedded credentials")

    try:
        worker = vision.start_camera(
            camera_id=camera_id,
            source_type=payload.source,
            source_url=stream_url,
            zones=vision_zones(db, camera_id),
            event_callback=persist_vision_event,
            credential_username=camera.username,
            credential_password=camera.password,
        )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    return vision.worker_snapshot(worker)


@app.post(f"{settings.api_v1_prefix}/cameras/{{camera_id}}/vision/stop")
def stop_camera_vision(
    camera_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if db.query(Camera).filter(Camera.id == camera_id).first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    worker = vision.stop_camera(camera_id)
    if worker is None:
        return {"camera_id": camera_id, "status": "Not connected"}
    return vision.worker_snapshot(worker)


@app.get(f"{settings.api_v1_prefix}/cameras/{{camera_id}}/vision/status")
def camera_vision_status(
    camera_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if db.query(Camera).filter(Camera.id == camera_id).first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    worker = vision.camera_worker(camera_id)
    return (
        vision.worker_snapshot(worker)
        if worker
        else {
            "camera_id": camera_id,
            "status": "Not connected",
            "running": False,
            "has_frame": False,
        }
    )


@app.get(f"{settings.api_v1_prefix}/cameras/{{camera_id}}/vision/frame")
def camera_vision_frame(
    camera_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.query(Camera).filter(Camera.id == camera_id).first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    worker = vision.camera_worker(camera_id)
    frame = vision.latest_frame(worker) if worker else None
    if frame is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No processed frame is available")
    from fastapi.responses import Response

    return Response(content=frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


MAX_UPLOAD_BYTES = 100 * 1024 * 1024
UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads"


@app.post(f"{settings.api_v1_prefix}/cameras/{{camera_id}}/uploads", status_code=status.HTTP_202_ACCEPTED)
async def upload_test_video(
    camera_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if db.query(Camera).filter(Camera.id == camera_id).first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    if Path(file.filename or "").suffix.lower() != ".mp4" or file.content_type != "video/mp4":
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Upload an MP4 video (video/mp4)")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    temporary_path = UPLOAD_DIR / f"{secrets.token_hex(16)}.mp4"
    size = 0
    first_bytes = b""
    try:
        with temporary_path.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="MP4 must be 100 MB or smaller")
                if len(first_bytes) < 12:
                    first_bytes += chunk[: 12 - len(first_bytes)]
                destination.write(chunk)
        if len(first_bytes) < 8 or first_bytes[4:8] != b"ftyp":
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="The uploaded file is not a valid MP4 video")
        worker = vision.start_upload(
            camera_id=camera_id,
            file_path=str(temporary_path),
            zones=vision_zones(db, camera_id),
            event_callback=persist_vision_event,
        )
        return {"job_id": worker.key[len("upload-"):], **vision.worker_snapshot(worker)}
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@app.get(f"{settings.api_v1_prefix}/uploads/{{job_id}}")
def get_upload_status(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    result = vision.upload_status(job_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload job not found")
    return result


@app.get(f"{settings.api_v1_prefix}/uploads/{{job_id}}/frame")
def get_upload_frame(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    frame = vision.upload_frame(job_id)
    if frame is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No processed frame is available")
    from fastapi.responses import Response

    return Response(content=frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


def event_payload(event: DetectionEvent, camera: Camera | None) -> dict[str, Any]:
    return {
        "id": event.id,
        "camera_id": event.camera_id,
        "camera_name": camera.name if camera else "Deleted camera",
        "event_type": event.event_type,
        "zone_name": event.zone_name,
        "detail": event.detail,
        "frame_index": event.frame_index,
        "evidence_url": f"{settings.api_v1_prefix}/events/{event.id}/evidence",
        "created_at": serialize_utc_datetime(event.created_at),
    }


def filtered_incident_query(
    db: Session,
    *,
    start: datetime | None,
    end: datetime | None,
    zone_id: int | None,
    camera_id: int | None,
    event_type: str | None,
    search: str | None,
):
    query = (
        db.query(DetectionEvent, Camera, SafetyAlert)
        .outerjoin(Camera, Camera.id == DetectionEvent.camera_id)
        .outerjoin(SafetyAlert, SafetyAlert.event_id == DetectionEvent.id)
    )
    if start is not None:
        query = query.filter(DetectionEvent.created_at >= start)
    if end is not None:
        query = query.filter(DetectionEvent.created_at < end)
    if zone_id is not None:
        query = query.filter(
            or_(
                DetectionEvent.zone_id == zone_id,
                (DetectionEvent.zone_id.is_(None))
                & (DetectionEvent.zone_name == db.query(Zone.name).filter(Zone.id == zone_id).scalar_subquery()),
            )
        )
    if camera_id is not None:
        query = query.filter(DetectionEvent.camera_id == camera_id)
    if event_type:
        query = query.filter(DetectionEvent.event_type == event_type)
    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                DetectionEvent.zone_name.ilike(search_pattern),
                DetectionEvent.event_type.ilike(search_pattern),
                DetectionEvent.detail.ilike(search_pattern),
                Camera.name.ilike(search_pattern),
            )
        )
    return query


def incident_payload(event: DetectionEvent, camera: Camera | None, alert: SafetyAlert | None) -> dict[str, Any]:
    return {
        **event_payload(event, camera),
        "alert_id": alert.id if alert else None,
        "alert_status": alert.status if alert else None,
        "alert_created_at": serialize_utc_datetime(alert.created_at) if alert else None,
    }


@app.get(f"{settings.api_v1_prefix}/incidents")
def list_incidents(
    start: datetime | None = None,
    end: datetime | None = None,
    zone_id: int | None = None,
    camera_id: int | None = None,
    event_type: str | None = None,
    search: str | None = Query(default=None, max_length=120),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    query = filtered_incident_query(
        db,
        start=start,
        end=end,
        zone_id=zone_id,
        camera_id=camera_id,
        event_type=event_type,
        search=search,
    )
    total = query.count()
    rows = (
        query.order_by(DetectionEvent.created_at.desc(), DetectionEvent.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": [incident_payload(event, camera, alert) for event, camera, alert in rows],
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": (total + page_size - 1) // page_size,
    }


@app.get(f"{settings.api_v1_prefix}/incidents/export.csv")
def export_incidents_csv(
    start: datetime | None = None,
    end: datetime | None = None,
    zone_id: int | None = None,
    camera_id: int | None = None,
    event_type: str | None = None,
    search: str | None = Query(default=None, max_length=120),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = filtered_incident_query(
        db,
        start=start,
        end=end,
        zone_id=zone_id,
        camera_id=camera_id,
        event_type=event_type,
        search=search,
    ).order_by(DetectionEvent.created_at.desc(), DetectionEvent.id.desc()).all()
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["Event ID", "Timestamp (UTC)", "Camera", "Zone", "Event type", "Details", "Alert status", "Frame"])
    for event, camera, alert in rows:
        writer.writerow(
            [
                event.id,
                serialize_utc_datetime(event.created_at),
                camera.name if camera else "Deleted camera",
                event.zone_name,
                event.event_type,
                event.detail,
                alert.status if alert else "",
                event.frame_index,
            ]
        )
    from fastapi.responses import Response

    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="incident-history.csv"'},
    )


@app.get(f"{settings.api_v1_prefix}/events")
def list_detection_events(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return [
        event_payload(event, db.query(Camera).filter(Camera.id == event.camera_id).first() if event.camera_id else None)
        for event in db.query(DetectionEvent).order_by(DetectionEvent.created_at.desc()).limit(100).all()
    ]


@app.delete(f"{settings.api_v1_prefix}/cameras/{{camera_id}}/events")
def clear_camera_detection_data(
    camera_id: int,
    current_user: User = Depends(require_roles([UserRole.ADMINISTRATOR.value])),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    if db.query(Camera).filter(Camera.id == camera_id).first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")

    with vision_event_store_lock:
        events = db.query(DetectionEvent).filter(DetectionEvent.camera_id == camera_id).all()
        event_ids = [event.id for event in events]
        evidence_filenames = [event.evidence_filename for event in events]
        alerts_deleted = (
            db.query(SafetyAlert).filter(SafetyAlert.event_id.in_(event_ids)).count()
            if event_ids
            else 0
        )

        if event_ids:
            db.query(SafetyAlert).filter(SafetyAlert.event_id.in_(event_ids)).delete(synchronize_session=False)
            db.query(DetectionEvent).filter(DetectionEvent.id.in_(event_ids)).delete(synchronize_session=False)
            db.commit()

        failed_files = []
        for filename in evidence_filenames:
            try:
                vision.get_evidence_path(filename).unlink(missing_ok=True)
            except OSError:
                failed_files.append(filename)
        if failed_files:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Detection records were cleared, but {len(failed_files)} evidence frame(s) could not be deleted",
            )

    return {
        "camera_id": camera_id,
        "events_deleted": len(event_ids),
        "alerts_deleted": alerts_deleted,
        "evidence_deleted": len(evidence_filenames),
    }


@app.delete(f"{settings.api_v1_prefix}/detection-data")
def clear_all_detection_data(
    current_user: User = Depends(
        require_roles([UserRole.ADMINISTRATOR.value, UserRole.SAFETY_OFFICER.value])
    ),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    with vision_event_store_lock:
        events = db.query(DetectionEvent).all()
        event_ids = [event.id for event in events]
        evidence_filenames = {event.evidence_filename for event in events}
        alerts_deleted = db.query(SafetyAlert).count()
        real_history_deleted = (
            db.query(RiskScoreHistory)
            .filter(RiskScoreHistory.is_simulated.is_(False))
            .count()
        )

        db.query(SafetyAlert).delete(synchronize_session=False)
        db.query(DetectionEvent).delete(synchronize_session=False)
        db.query(RiskScoreHistory).filter(RiskScoreHistory.is_simulated.is_(False)).delete(
            synchronize_session=False
        )
        db.commit()

        failed_files = []
        for filename in evidence_filenames:
            try:
                vision.get_evidence_path(filename).unlink(missing_ok=True)
            except OSError:
                failed_files.append(filename)
        if failed_files:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Detection records were cleared, but {len(failed_files)} evidence frame(s) could not be deleted",
            )

    return {
        "events_deleted": len(event_ids),
        "alerts_deleted": alerts_deleted,
        "evidence_deleted": len(evidence_filenames),
        "risk_history_deleted": real_history_deleted,
    }


@app.get(f"{settings.api_v1_prefix}/events/{{event_id}}/evidence")
def get_event_evidence(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(DetectionEvent).filter(DetectionEvent.id == event_id).first()
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    evidence_path = vision.get_evidence_path(event.evidence_filename)
    if not evidence_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence frame is unavailable")
    from fastapi.responses import FileResponse

    return FileResponse(evidence_path, media_type="image/jpeg")


def safety_alert_payload(db: Session, alert: SafetyAlert, event: DetectionEvent) -> dict[str, Any]:
    assignee = db.query(User).filter(User.id == alert.assigned_user_id).first() if alert.assigned_user_id else None
    return {
        **event_payload(
            event,
            db.query(Camera).filter(Camera.id == event.camera_id).first() if event.camera_id else None,
        ),
        "alert_id": alert.id,
        "status": alert.status,
        "severity": "High" if event.event_type == "Restricted-zone entry" else "Medium",
        "created_at": serialize_utc_datetime(alert.created_at),
        "assigned_user_id": alert.assigned_user_id,
        "assigned_user_name": assignee.full_name if assignee else None,
        "zone_id": event.zone_id,
    }


def record_alert_action(db: Session, user: User, alert_id: int, action: str, details: str) -> None:
    db.add(
        AuditLog(
            user_id=user.id,
            email=user.email,
            role=user.role,
            action=action,
            details=f"Alert {alert_id}: {details}"[:500],
        )
    )


@app.get(f"{settings.api_v1_prefix}/users/assignable")
def list_assignable_users(
    current_user: User = Depends(require_roles([UserRole.SAFETY_OFFICER.value, UserRole.ADMINISTRATOR.value])),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return [
        {"id": user.id, "full_name": user.full_name, "role": user.role}
        for user in (
            db.query(User)
            .filter(User.role.in_([UserRole.SAFETY_OFFICER.value, UserRole.ADMINISTRATOR.value]))
            .order_by(User.full_name)
            .all()
        )
    ]


@app.get(f"{settings.api_v1_prefix}/alerts")
def list_safety_alerts(
    severity: str | None = Query(default=None, regex="^(High|Medium)$"),
    alert_status: str | None = Query(
        default=None,
        alias="status",
        regex="^(New|Acknowledged|Under Investigation|Resolved|False Positive)$",
    ),
    zone_id: int | None = Query(default=None),
    camera_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    query = db.query(SafetyAlert, DetectionEvent).join(
        DetectionEvent, SafetyAlert.event_id == DetectionEvent.id
    )
    if alert_status:
        query = query.filter(SafetyAlert.status == alert_status)
    if severity == "High":
        query = query.filter(DetectionEvent.event_type == "Restricted-zone entry")
    elif severity == "Medium":
        query = query.filter(DetectionEvent.event_type != "Restricted-zone entry")
    if zone_id is not None:
        query = query.filter(DetectionEvent.zone_id == zone_id)
    if camera_id is not None:
        query = query.filter(DetectionEvent.camera_id == camera_id)
    if date_from is not None:
        query = query.filter(SafetyAlert.created_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc))
    if date_to is not None:
        if date_from is not None and date_to < date_from:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="End date must not precede start date")
        query = query.filter(
            SafetyAlert.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        )
    rows = query.order_by(SafetyAlert.created_at.desc()).limit(500).all()
    return [safety_alert_payload(db, alert, event) for alert, event in rows]


@app.get(f"{settings.api_v1_prefix}/alerts/{{alert_id}}")
def get_safety_alert(
    alert_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    row = (
        db.query(SafetyAlert, DetectionEvent)
        .join(DetectionEvent, SafetyAlert.event_id == DetectionEvent.id)
        .filter(SafetyAlert.id == alert_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    alert, event = row
    notes = (
        db.query(AlertNote, User)
        .outerjoin(User, User.id == AlertNote.user_id)
        .filter(AlertNote.alert_id == alert_id)
        .order_by(AlertNote.created_at)
        .all()
    )
    return {
        **safety_alert_payload(db, alert, event),
        "notes": [
            {
                "id": note.id,
                "user_id": note.user_id,
                "user_name": user.full_name if user else "Former user",
                "note": note.note,
                "created_at": serialize_utc_datetime(note.created_at),
            }
            for note, user in notes
        ],
    }


@app.patch(f"{settings.api_v1_prefix}/alerts/{{alert_id}}")
def update_safety_alert(
    alert_id: int,
    payload: AlertUpdate,
    current_user: User = Depends(
        require_roles([UserRole.SAFETY_OFFICER.value, UserRole.ADMINISTRATOR.value])
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    alert = db.query(SafetyAlert).filter(SafetyAlert.id == alert_id).first()
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    changes = payload.dict(exclude_unset=True)
    if "status" in changes and changes["status"] != alert.status:
        previous_status = alert.status
        alert.status = changes["status"]
        record_alert_action(
            db, current_user, alert.id, "alert_status",
            f"status changed from {previous_status} to {alert.status}",
        )
    if "assigned_user_id" in changes and changes["assigned_user_id"] != alert.assigned_user_id:
        assigned_user_id = changes["assigned_user_id"]
        assignee = None
        if assigned_user_id is not None:
            assignee = db.query(User).filter(User.id == assigned_user_id).first()
            if assignee is None or assignee.role not in {
                UserRole.SAFETY_OFFICER.value,
                UserRole.ADMINISTRATOR.value,
            }:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Select an active safety officer or administrator")
        previous_id = alert.assigned_user_id
        alert.assigned_user_id = assigned_user_id
        record_alert_action(
            db,
            current_user,
            alert.id,
            "alert_assignment",
            f"assignment changed from user {previous_id or 'unassigned'} to {assignee.full_name if assignee else 'unassigned'}",
        )
    db.commit()
    event = db.query(DetectionEvent).filter(DetectionEvent.id == alert.event_id).first()
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection event not found")
    return safety_alert_payload(db, alert, event)


@app.post(f"{settings.api_v1_prefix}/alerts/{{alert_id}}/notes", status_code=status.HTTP_201_CREATED)
def add_safety_alert_note(
    alert_id: int,
    payload: AlertNoteCreate,
    current_user: User = Depends(
        require_roles([UserRole.SAFETY_OFFICER.value, UserRole.ADMINISTRATOR.value])
    ),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    alert = db.query(SafetyAlert).filter(SafetyAlert.id == alert_id).first()
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    note = AlertNote(alert_id=alert.id, user_id=current_user.id, note=payload.note)
    db.add(note)
    db.flush()
    record_alert_action(db, current_user, alert.id, "alert_note", f"note added: {payload.note}")
    db.commit()
    db.refresh(note)
    return {
        "id": note.id,
        "user_id": current_user.id,
        "user_name": current_user.full_name,
        "note": note.note,
        "created_at": serialize_utc_datetime(note.created_at),
    }


@app.get(f"{settings.api_v1_prefix}/audit-logs")
def list_audit_logs(
    current_user: User = Depends(require_roles([UserRole.ADMINISTRATOR.value])),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return [
        {
            "id": log.id,
            "user_id": log.user_id,
            "email": log.email,
            "role": log.role,
            "action": log.action,
            "details": log.details,
            "logged_at": serialize_utc_datetime(log.logged_at),
        }
        for log in db.query(AuditLog).order_by(AuditLog.logged_at.desc()).limit(100).all()
    ]


@app.get(f"{settings.api_v1_prefix}/auth/safety-check")
def safety_access_check(current_user: User = Depends(require_roles([UserRole.SAFETY_OFFICER.value, UserRole.ADMINISTRATOR.value]))) -> dict[str, str]:
    return {"status": "ok", "role": current_user.role, "message": "Safety access confirmed"}


@app.get(f"{settings.api_v1_prefix}/auth/admin-check")
def admin_access_check(current_user: User = Depends(require_roles([UserRole.ADMINISTRATOR.value]))) -> dict[str, str]:
    return {"status": "ok", "role": current_user.role, "message": "Admin access confirmed"}
