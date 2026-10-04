from collections.abc import Generator
from pathlib import Path
import sqlite3
from typing import TypedDict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import vision
from app.main import (
    Base,
    Camera,
    DetectionEvent,
    RiskScoreHistory,
    SafetyAlert,
    User,
    Zone,
    app,
    get_current_user,
    get_db,
)

class ClearEventTestState(TypedDict):
    camera_id: str
    other_camera_id: str
    database_path: str
    evidence_dir: str
    role: dict[str, str]


@pytest.fixture
def clear_events_client(tmp_path, monkeypatch) -> Generator[tuple[TestClient, ClearEventTestState], None, None]:
    database_path = tmp_path / "clear-events.sqlite3"
    test_engine = create_engine(f"sqlite:///{database_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=test_engine)
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    evidence_dir = tmp_path / "evidence"
    evidence_dir.mkdir()
    monkeypatch.setattr(vision, "EVIDENCE_DIR", evidence_dir)

    role = {"value": "safety_officer"}

    def override_db() -> Generator[Session, None, None]:
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: User(
        id=1,
        full_name="Test user",
        email="clear-events@example.invalid",
        password_hash="",
        role=role["value"],
    )

    with test_session() as db:
        cameras = [
            Camera(name="Camera 1", location="Test area"),
            Camera(name="Camera 2", location="Other area"),
        ]
        db.add_all(cameras)
        db.flush()
        zone = Zone(
                name="Keep this zone",
                camera_id=cameras[0].id,
                zone_type="normal",
                shape_type="rectangle",
                coordinates={"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5},
                crowd_threshold=10,
                confidence_threshold=0.5,
            )
        db.add(zone)
        db.add(
            User(
                full_name="Persisted user",
                email="persisted-user@example.invalid",
                password_hash="test",
                role="administrator",
            )
        )
        for camera in cameras:
            evidence_filename = f"event-{camera.id}.jpg"
            (evidence_dir / evidence_filename).write_bytes(b"test evidence")
            event = DetectionEvent(
                camera_id=camera.id,
                zone_id=zone.id if camera.id == cameras[0].id else None,
                event_type="Restricted-zone entry",
                zone_name=f"Zone {camera.id}",
                detail="Test event",
                evidence_filename=evidence_filename,
                frame_index=30,
            )
            db.add(event)
            db.flush()
            db.add(SafetyAlert(event_id=event.id))
        db.add_all(
            [
                RiskScoreHistory(
                    zone_id=zone.id,
                    score=25,
                    trend="increasing",
                    velocity=2.0,
                    projected_score=35,
                    explanation="Real risk history",
                    is_simulated=False,
                ),
                RiskScoreHistory(
                    zone_id=zone.id,
                    score=40,
                    trend="stable",
                    velocity=0.0,
                    projected_score=40,
                    explanation="SIMULATED history",
                    is_simulated=True,
                ),
            ]
        )
        db.commit()
        camera_id = cameras[0].id
        other_camera_id = cameras[1].id

    try:
        with TestClient(app) as client:
            yield client, {
                "camera_id": str(camera_id),
                "other_camera_id": str(other_camera_id),
                "database_path": str(database_path),
                "evidence_dir": str(evidence_dir),
                "role": role,
            }
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()


def test_only_admin_can_clear_camera_events_and_evidence(clear_events_client) -> None:
    client, state = clear_events_client
    camera_id = state["camera_id"]
    other_camera_id = state["other_camera_id"]
    evidence_dir = Path(state["evidence_dir"])
    target_evidence = evidence_dir / f"event-{camera_id}.jpg"

    forbidden = client.delete(f"/api/cameras/{camera_id}/events")
    assert forbidden.status_code == 403
    assert target_evidence.is_file()

    state["role"]["value"] = "administrator"
    response = client.delete(f"/api/cameras/{camera_id}/events")
    assert response.status_code == 200
    assert response.json() == {
        "camera_id": int(camera_id),
        "events_deleted": 1,
        "alerts_deleted": 1,
        "evidence_deleted": 1,
    }

    assert len(client.get("/api/cameras").json()) == 2
    assert len(client.get("/api/zones").json()) == 1
    remaining_events = client.get("/api/events")
    assert remaining_events.status_code == 200
    assert len(remaining_events.json()) == 1
    assert remaining_events.json()[0]["camera_id"] == int(other_camera_id)
    assert not target_evidence.is_file()
    assert (evidence_dir / f"event-{other_camera_id}.jpg").is_file()

    connection = sqlite3.connect(state["database_path"])
    try:
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
    finally:
        connection.close()


@pytest.mark.parametrize("authorized_role", ["administrator", "safety_officer"])
def test_authorized_role_can_clear_real_detection_data_and_preserve_simulated_history(
    clear_events_client, authorized_role: str
) -> None:
    client, state = clear_events_client
    evidence_dir = Path(state["evidence_dir"])

    state["role"]["value"] = "unauthorized"
    forbidden = client.delete("/api/detection-data")
    assert forbidden.status_code == 403
    assert len(client.get("/api/events").json()) == 2

    state["role"]["value"] = authorized_role
    response = client.delete("/api/detection-data")
    assert response.status_code == 200
    assert response.json() == {
        "events_deleted": 2,
        "alerts_deleted": 2,
        "evidence_deleted": 2,
        "risk_history_deleted": 1,
    }
    assert client.get("/api/events").json() == []
    assert client.get("/api/alerts").json() == []
    assert all(
        risk["history"] and all(point["is_simulated"] for point in risk["history"])
        for risk in client.get("/api/risk/zones").json()
    )
    assert not (evidence_dir / "event-1.jpg").exists()
    assert not (evidence_dir / "event-2.jpg").exists()

    connection = sqlite3.connect(state["database_path"])
    try:
        assert connection.execute("SELECT COUNT(*) FROM cameras").fetchone()[0] == 2
        assert connection.execute("SELECT COUNT(*) FROM zones").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM detection_events").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM safety_alerts").fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM risk_score_history WHERE is_simulated = 0"
        ).fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM risk_score_history WHERE is_simulated = 1"
        ).fetchone()[0] == 1
    finally:
        connection.close()
