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
    User,
    Zone,
    app,
    get_current_user,
    get_db,
)


@pytest.fixture
def risk_client(tmp_path) -> Generator[tuple[TestClient, dict[str, str]], None, None]:
    database_path = tmp_path / "risk.sqlite3"
    test_engine = create_engine(f"sqlite:///{database_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=test_engine)
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=test_engine, expire_on_commit=False)
    role = {"value": "administrator"}

    def override_db() -> Generator[Session, None, None]:
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: User(
        id=1,
        full_name="Risk Admin",
        email="risk-admin@example.invalid",
        password_hash="",
        role=role["value"],
    )
    with test_session() as db:
        camera = Camera(name="Risk camera", location="Test area")
        db.add(camera)
        db.flush()
        test_zone = Zone(
            name="Restricted area",
            camera_id=camera.id,
            zone_type="restricted",
            shape_type="rectangle",
            coordinates={"x": 0.1, "y": 0.1, "width": 0.4, "height": 0.4},
            crowd_threshold=3,
            confidence_threshold=0.5,
        )
        db.add(test_zone)
        db.flush()
        db.add(
            DetectionEvent(
                camera_id=camera.id,
                zone_id=test_zone.id,
                event_type="Restricted-zone entry",
                zone_name=test_zone.name,
                detail="Test entry",
                evidence_filename="unused.jpg",
                frame_index=1,
                created_at=datetime.now(timezone.utc),
            )
        )
        db.commit()

    try:
        with TestClient(app) as client:
            yield client, role
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()


def test_risk_endpoint_calculates_from_real_events_with_utc_timestamp(risk_client) -> None:
    client, _role = risk_client
    response = client.get("/api/risk/zones")

    assert response.status_code == 200
    risk = response.json()[0]
    assert risk["score"] == 15
    assert risk["trend"] == "stable"
    assert risk["history"] == []
    assert risk["updated_at"].endswith("Z")
    assert "increased by 15 points" in risk["explanation"]
    assert "1 restricted-zone entry" in risk["explanation"]


def test_admin_simulated_history_is_marked_separate_and_clearable(risk_client) -> None:
    client, role = risk_client

    role["value"] = "safety_officer"
    assert client.post("/api/risk/simulated-history").status_code == 403
    role["value"] = "administrator"
    seeded = client.post("/api/risk/simulated-history")
    assert seeded.status_code == 200
    assert seeded.json() == {"zones_seeded": 1, "samples_created": 12}

    history = client.get("/api/risk/zones").json()[0]["history"]
    assert len(history) == 12
    assert all(entry["is_simulated"] for entry in history)
    assert all("SIMULATED" in entry["explanation"] for entry in history)
    assert all(entry["recorded_at"].endswith("Z") for entry in history)
    assert client.get("/api/risk/zones").json()[0]["score"] == 15

    cleared = client.delete("/api/risk/simulated-history")
    assert cleared.status_code == 200
    assert cleared.json() == {"samples_deleted": 12}
    risk = client.get("/api/risk/zones").json()[0]
    assert risk["history"] == []
    assert risk["score"] == 15
