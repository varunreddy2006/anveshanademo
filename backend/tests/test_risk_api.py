from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

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
    zone_period_analytics,
)
from app.risk import RiskWeights


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
        db.add_all(
            [
                Zone(
                    name="Hazard demo area",
                    camera_id=camera.id,
                    zone_type="hazard_machinery",
                    shape_type="rectangle",
                    coordinates={"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.3},
                    crowd_threshold=3,
                    confidence_threshold=0.5,
                ),
                Zone(
                    name="Stable demo area",
                    camera_id=camera.id,
                    zone_type="normal",
                    shape_type="rectangle",
                    coordinates={"x": 0.3, "y": 0.3, "width": 0.2, "height": 0.2},
                    crowd_threshold=3,
                    confidence_threshold=0.5,
                ),
            ]
        )
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


def test_risk_period_categories_recommendations_repeat_badge_and_comparison(risk_client) -> None:
    client, _role = risk_client
    now = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
    start = now - timedelta(hours=1)
    previous_start = start - timedelta(hours=1)
    events = [
        SimpleNamespace(event_type="Restricted-zone entry", created_at=now - timedelta(minutes=5)),
        SimpleNamespace(event_type="Restricted-zone entry", created_at=now - timedelta(minutes=4)),
        SimpleNamespace(event_type="Restricted-zone entry", created_at=now - timedelta(minutes=3)),
        SimpleNamespace(event_type="Hazard-zone proximity", created_at=now - timedelta(minutes=2)),
        SimpleNamespace(event_type="Restricted-zone entry", created_at=now - timedelta(minutes=70)),
        SimpleNamespace(event_type="Restricted-zone entry", created_at=now - timedelta(minutes=80)),
        SimpleNamespace(event_type="Crowding threshold", created_at=now - timedelta(hours=3)),
    ]

    summary = zone_period_analytics(
        events,
        start=start,
        previous_start=previous_start,
        now=now,
        weights=RiskWeights(),
        half_life_minutes=30,
    )
    assert summary["period_event_count"] == 4
    assert summary["event_categories"] == [
        {"event_type": "Restricted-zone entry", "count": 3},
        {"event_type": "Hazard-zone proximity", "count": 1},
    ]
    assert summary["recommendations"][0] == {
        "event_type": "Restricted-zone entry",
        "count": 3,
        "action": "Review access controls and reinforce restricted-zone procedures.",
    }
    assert len(summary["recommendations"]) == 1
    assert summary["period_score_change"] > 0

    response = client.get("/api/risk/zones?period=today")
    assert response.status_code == 200
    zone = response.json()[0]
    assert zone["period"] == "today"
    assert zone["period_event_count"] == 1
    assert zone["event_categories"] == [{"event_type": "Restricted-zone entry", "count": 1}]
    assert zone["recommendations"][0]["event_type"] == "Restricted-zone entry"
    assert zone["period_start"].endswith("Z")
    for period in ("hour", "7d"):
        assert client.get(f"/api/risk/zones?period={period}").status_code == 200


def test_risk_configuration_endpoint_exposes_configured_weights_and_bands(risk_client) -> None:
    client, _role = risk_client
    config = client.get("/api/risk/config")

    assert config.status_code == 200
    assert config.json()["weights"] == {
        "restricted_entry": 15,
        "hazard_proximity": 12,
        "crowding": 8,
        "missing_helmet": 10,
        "missing_vest": 10,
        "smoke": 35,
        "fire": 60,
    }
    assert config.json()["decay_half_life_minutes"] == 30
    assert config.json()["bands"] == {"low_max": 33, "guarded_max": 55, "elevated_max": 75}
    assert client.get("/api/risk/zones?period=invalid").status_code == 422


@pytest.mark.parametrize("authorized_role", ["administrator", "safety_officer"])
def test_authorized_roles_can_seed_and_clear_separate_simulated_history(
    risk_client, authorized_role: str
) -> None:
    client, role = risk_client

    role["value"] = "unauthorized"
    assert client.post("/api/risk/simulated-history").status_code == 403
    assert client.delete("/api/risk/simulated-history").status_code == 403

    role["value"] = authorized_role
    seeded = client.post("/api/risk/simulated-history")
    assert seeded.status_code == 200
    assert seeded.json() == {"zones_seeded": 3, "samples_created": 36}

    risks = client.get("/api/risk/zones").json()
    increasing, rapid, stable = risks
    assert len(client.get("/api/events").json()) == 1
    assert all(len(risk["history"]) == 12 for risk in risks)
    assert all(
        entry["is_simulated"] and "SIMULATED" in entry["explanation"] and entry["recorded_at"].endswith("Z")
        for risk in risks
        for entry in risk["history"]
    )
    assert increasing["simulated_demo"]["score"] == 85
    assert increasing["simulated_demo"]["trend"] == "increasing"
    assert increasing["simulated_demo"]["score"] > 70
    assert increasing["simulated_demo"]["rapid_escalation"] is False
    assert "Risk increased by 25 points" in increasing["simulated_demo"]["explanation"]
    assert rapid["simulated_demo"]["trend"] == "increasing"
    assert rapid["simulated_demo"]["rapid_escalation"] is True
    assert stable["simulated_demo"]["score"] == 20
    assert stable["simulated_demo"]["score"] <= 33
    assert stable["simulated_demo"]["trend"] == "stable"
    assert stable["simulated_demo"]["rapid_escalation"] is False
    assert all(risk["score"] == 15 for risk in risks[:1])

    cleared = client.delete("/api/risk/simulated-history")
    assert cleared.status_code == 200
    assert cleared.json() == {"samples_deleted": 36}
    risks = client.get("/api/risk/zones").json()
    assert all(risk["history"] == [] and risk["simulated_demo"] is None for risk in risks)
    assert risks[0]["score"] == 15
    assert len(client.get("/api/events").json()) == 1
