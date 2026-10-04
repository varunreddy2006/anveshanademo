from collections.abc import Generator
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.main import (
    Base,
    Camera,
    DetectionEvent,
    SafetyAlert,
    User,
    Zone,
    app,
    get_current_user,
    get_db,
)


@pytest.fixture
def alert_client(tmp_path) -> Generator[tuple[TestClient, dict[str, int | str]], None, None]:
    database_path = tmp_path / "alerts.sqlite3"
    engine = create_engine(f"sqlite:///{database_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    current_user: dict[str, int | str] = {"id": 1, "role": "safety_officer"}

    def override_db() -> Generator[Session, None, None]:
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    def override_user() -> User:
        with test_session() as db:
            user = db.query(User).filter(User.id == current_user["id"]).first()
            assert user is not None
            return user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user

    with test_session() as db:
        officer = User(
            full_name="Safety Officer",
            email="officer@example.invalid",
            password_hash="test",
            role="safety_officer",
        )
        administrator = User(
            full_name="Administrator",
            email="admin@example.invalid",
            password_hash="test",
            role="administrator",
        )
        viewer = User(
            full_name="Viewer",
            email="viewer@example.invalid",
            password_hash="test",
            role="viewer",
        )
        camera = Camera(name="Press 1", location="Floor 1")
        db.add_all([officer, administrator, viewer, camera])
        db.flush()
        zone = Zone(
            name="Restricted floor",
            camera_id=camera.id,
            zone_type="restricted",
            shape_type="rectangle",
            coordinates={"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5},
            crowd_threshold=10,
            confidence_threshold=0.5,
        )
        db.add(zone)
        db.flush()
        event = DetectionEvent(
            camera_id=camera.id,
            zone_id=zone.id,
            event_type="Restricted-zone entry",
            zone_name=zone.name,
            detail="Tracked person entered restricted floor",
            evidence_filename="alert-evidence.jpg",
            frame_index=12,
            created_at=datetime.now(timezone.utc),
        )
        db.add(event)
        db.flush()
        alert = SafetyAlert(event_id=event.id)
        db.add(alert)
        db.commit()
        current_user["id"] = officer.id
        alert_id = alert.id
        event_id = event.id
        officer_id = officer.id
        administrator_id = administrator.id
        viewer_id = viewer.id
        zone_id = zone.id
        camera_id = camera.id

    try:
        with TestClient(app) as client:
            yield client, {
                "alert_id": alert_id,
                "event_id": event_id,
                "officer_id": officer_id,
                "administrator_id": administrator_id,
                "viewer_id": viewer_id,
                "zone_id": zone_id,
                "camera_id": camera_id,
                "database_path": str(database_path),
                "current_user": current_user,
            }
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_safety_officer_can_update_alert_assignment_and_add_audited_note(alert_client) -> None:
    client, state = alert_client
    alert_id = state["alert_id"]
    assert isinstance(alert_id, int)

    changed = client.patch(
        f"/api/alerts/{alert_id}",
        json={"status": "Under Investigation"},
    )
    assert changed.status_code == 200
    assert changed.json()["status"] == "Under Investigation"
    assert changed.json()["created_at"].endswith("Z")

    assignment = client.patch(
        f"/api/alerts/{alert_id}",
        json={"assigned_user_id": state["administrator_id"]},
    )
    assert assignment.status_code == 200
    assert assignment.json()["assigned_user_name"] == "Administrator"

    note = client.post(
        f"/api/alerts/{alert_id}/notes",
        json={"note": "  Confirmed with the floor supervisor.  "},
    )
    assert note.status_code == 201
    assert note.json()["note"] == "Confirmed with the floor supervisor."
    assert note.json()["user_name"] == "Safety Officer"
    assert note.json()["created_at"].endswith("Z")

    details = client.get(f"/api/alerts/{alert_id}")
    assert details.status_code == 200
    assert len(details.json()["notes"]) == 1
    assert details.json()["notes"][0]["note"] == note.json()["note"]

    state["current_user"]["id"] = state["administrator_id"]
    audit_logs = client.get("/api/audit-logs")
    assert audit_logs.status_code == 200
    audit_entries = audit_logs.json()
    assert {entry["action"] for entry in audit_entries} >= {
        "alert_status",
        "alert_assignment",
        "alert_note",
    }
    assert all(entry["user_id"] == state["officer_id"] for entry in audit_entries)
    assert all(entry["logged_at"].endswith("Z") for entry in audit_entries)


def test_alert_role_permissions_validation_and_filters(alert_client) -> None:
    client, state = alert_client
    alert_id = state["alert_id"]

    state["current_user"]["id"] = state["viewer_id"]
    assert client.patch(f"/api/alerts/{alert_id}", json={"status": "Resolved"}).status_code == 403
    assert client.post(f"/api/alerts/{alert_id}/notes", json={"note": "Not allowed"}).status_code == 403

    state["current_user"]["id"] = state["officer_id"]
    assert client.patch(f"/api/alerts/{alert_id}", json={"status": "Invalid"}).status_code == 422
    assert client.patch(f"/api/alerts/{alert_id}", json={}).status_code == 422
    assert client.post(f"/api/alerts/{alert_id}/notes", json={"note": "   "}).status_code == 422

    base = client.get("/api/alerts")
    assert base.status_code == 200
    assert len(base.json()) == 1
    assert len(client.get("/api/alerts", params={"severity": "High"}).json()) == 1
    assert client.get("/api/alerts", params={"severity": "Medium"}).json() == []
    assert len(client.get("/api/alerts", params={"zone_id": state["zone_id"]}).json()) == 1
    assert len(client.get("/api/alerts", params={"camera_id": state["camera_id"]}).json()) == 1
    assert client.get("/api/alerts", params={"status": "Resolved"}).json() == []
    today = datetime.now(timezone.utc).date().isoformat()
    assert len(client.get("/api/alerts", params={"date_from": today, "date_to": today}).json()) == 1
    assert client.get("/api/alerts", params={"date_to": "2000-01-01"}).json() == []

    state["current_user"]["id"] = state["administrator_id"]
    assert client.patch(
        f"/api/alerts/{alert_id}",
        json={"status": "Acknowledged"},
    ).status_code == 200
    assignable_users = client.get("/api/users/assignable")
    assert assignable_users.status_code == 200
    assert {user["role"] for user in assignable_users.json()} == {
        "administrator",
        "safety_officer",
    }


def test_alert_severity_filters_include_ppe_smoke_and_fire(alert_client) -> None:
    client, state = alert_client
    engine = create_engine(f"sqlite:///{state['database_path']}")
    test_session = sessionmaker(bind=engine)
    with test_session() as db:
        for event_type in ("Missing helmet", "Smoke detected", "Fire detected"):
            event = DetectionEvent(
                camera_id=state["camera_id"],
                zone_id=state["zone_id"],
                event_type=event_type,
                zone_name="Restricted floor",
                detail=f"Mock {event_type}",
                evidence_filename="mock.jpg",
                frame_index=20,
            )
            db.add(event)
            db.flush()
            db.add(SafetyAlert(event_id=event.id))
        db.commit()
    engine.dispose()

    critical = client.get("/api/alerts", params={"severity": "Critical"})
    high = client.get("/api/alerts", params={"severity": "High"})
    medium = client.get("/api/alerts", params={"severity": "Medium"})
    fire = client.get("/api/alerts", params={"event_type": "Fire detected"})
    invalid_event_type = client.get("/api/alerts", params={"event_type": "Unrecognized event"})
    assert critical.status_code == high.status_code == medium.status_code == 200
    assert [alert["event_type"] for alert in critical.json()] == ["Fire detected"]
    assert {alert["event_type"] for alert in high.json()} == {
        "Restricted-zone entry",
        "Smoke detected",
    }
    assert [alert["event_type"] for alert in medium.json()] == ["Missing helmet"]
    assert [alert["event_type"] for alert in fire.json()] == ["Fire detected"]
    assert invalid_event_type.status_code == 422
