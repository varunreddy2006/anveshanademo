from collections.abc import Generator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.main import (
    AuditLog,
    Base,
    Camera,
    DetectionEvent,
    SafetyAlert,
    User,
    app,
    get_current_user,
    get_db,
)


@pytest.fixture
def timestamp_client(tmp_path) -> Generator[tuple[TestClient, sessionmaker[Session]], None, None]:
    database_path = tmp_path / "timestamps.sqlite3"
    test_engine = create_engine(f"sqlite:///{database_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=test_engine)
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=test_engine, expire_on_commit=False)

    def override_db() -> Generator[Session, None, None]:
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    admin = User(
        id=1,
        full_name="Timestamp Admin",
        email="timestamp-admin@example.invalid",
        password_hash="",
        role="administrator",
    )
    with test_session() as db:
        db.add(admin)
        camera = Camera(name="Timestamp camera", location="Test area")
        db.add(camera)
        db.flush()
        event = DetectionEvent(
            camera_id=camera.id,
            event_type="Restricted-zone entry",
            zone_name="Restricted area",
            detail="Test event",
            evidence_filename="timestamp-evidence.jpg",
            frame_index=12,
            created_at=datetime(2025, 3, 8, 13, 0, tzinfo=timezone.utc),
        )
        db.add(event)
        db.flush()
        db.add(
            SafetyAlert(
                event_id=event.id,
                created_at=datetime(2025, 3, 8, 18, 31, tzinfo=timezone(timedelta(hours=5, minutes=30))),
            )
        )
        db.add(
            AuditLog(
                user_id=admin.id,
                email=admin.email,
                role=admin.role,
                action="login",
                logged_at=datetime(2025, 3, 8, 13, 2, tzinfo=timezone.utc),
            )
        )
        db.commit()

        with test_engine.begin() as connection:
            connection.execute(
                text("UPDATE detection_events SET created_at = :created_at WHERE id = :event_id"),
                {"created_at": "2025-03-08 13:00:00.000000", "event_id": event.id},
            )

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: admin
    try:
        with TestClient(app) as client:
            yield client, test_session
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()


def assert_utc_timestamp(value: str) -> None:
    assert value.endswith("Z") or value.endswith("+00:00")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    assert parsed.utcoffset() == timedelta(0)


def test_timestamped_apis_serialize_utc_including_legacy_rows(timestamp_client) -> None:
    client, test_session = timestamp_client
    events = client.get("/api/events")
    alerts = client.get("/api/alerts")
    audit_logs = client.get("/api/audit-logs")

    assert events.status_code == alerts.status_code == audit_logs.status_code == 200
    assert events.json()[0]["created_at"] == "2025-03-08T13:00:00Z"
    assert alerts.json()[0]["created_at"] == "2025-03-08T13:01:00Z"
    assert audit_logs.json()[0]["logged_at"] == "2025-03-08T13:02:00Z"

    assert_utc_timestamp(events.json()[0]["created_at"])
    assert_utc_timestamp(alerts.json()[0]["created_at"])
    assert_utc_timestamp(audit_logs.json()[0]["logged_at"])

    with test_session() as db:
        event = db.query(DetectionEvent).one()
        alert = db.query(SafetyAlert).one()
        assert event.created_at.tzinfo == timezone.utc
        assert alert.created_at.tzinfo == timezone.utc
