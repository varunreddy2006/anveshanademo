from collections.abc import Generator
from datetime import datetime, timezone
from io import BytesIO, StringIO
import csv

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

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


@pytest.fixture
def reports_client(tmp_path) -> Generator[TestClient, None, None]:
    database_path = tmp_path / "incident-reports.sqlite3"
    test_engine = create_engine(f"sqlite:///{database_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=test_engine)
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=test_engine, expire_on_commit=False)

    def override_db() -> Generator[Session, None, None]:
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    user = User(
        id=1,
        full_name="Report User",
        email="report-user@example.invalid",
        password_hash="",
        role="administrator",
    )
    with test_session() as db:
        cameras = [
            Camera(name="Camera North", location="North plant"),
            Camera(name="Camera South", location="South plant"),
        ]
        zones = [
            Zone(
                name="Assembly",
                camera_id=None,
                zone_type="restricted",
                shape_type="rectangle",
                coordinates={"x": 0.1, "y": 0.1, "width": 0.4, "height": 0.4},
                crowd_threshold=4,
                confidence_threshold=0.5,
            ),
            Zone(
                name="Loading",
                camera_id=None,
                zone_type="hazard_machinery",
                shape_type="rectangle",
                coordinates={"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.3},
                crowd_threshold=3,
                confidence_threshold=0.5,
            ),
        ]
        db.add_all([user, *cameras, *zones])
        db.flush()
        fixtures = [
            (cameras[0], zones[0], "Restricted-zone entry", datetime(2026, 10, 4, 1, tzinfo=timezone.utc), "Unauthorized entry"),
            (cameras[0], zones[0], "Crowding threshold", datetime(2026, 10, 4, 2, tzinfo=timezone.utc), "Crowd observed"),
            (cameras[1], zones[1], "Hazard-zone proximity", datetime(2026, 10, 3, 12, tzinfo=timezone.utc), "Near machinery"),
        ]
        for camera, zone, event_type, created_at, detail in fixtures:
            event = DetectionEvent(
                camera_id=camera.id,
                zone_id=zone.id,
                event_type=event_type,
                zone_name=zone.name,
                detail=detail,
                evidence_filename=f"{event_type.replace(' ', '-')}.jpg",
                frame_index=30,
                created_at=created_at,
            )
            db.add(event)
            db.flush()
            db.add(SafetyAlert(event_id=event.id, status="Open"))
        db.add(
            RiskScoreHistory(
                zone_id=zones[0].id,
                score=44,
                trend="increasing",
                velocity=1.5,
                projected_score=52,
                explanation="SIMULATED",
                is_simulated=True,
                recorded_at=datetime(2026, 10, 4, 2, tzinfo=timezone.utc),
            )
        )
        db.commit()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()


def test_incident_filters_pagination_and_csv_export(reports_client: TestClient) -> None:
    params = {
        "start": "2026-10-04T00:00:00Z",
        "end": "2026-10-05T00:00:00Z",
        "zone_id": "1",
        "camera_id": "1",
        "event_type": "Restricted-zone entry",
        "search": "entry",
        "page": "1",
        "page_size": "1",
    }
    response = reports_client.get("/api/incidents", params=params)

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["pages"] == payload["page"] == 1
    assert payload["items"][0]["event_type"] == "Restricted-zone entry"
    assert payload["items"][0]["camera_name"] == "Camera North"
    assert payload["items"][0]["zone_name"] == "Assembly"
    assert payload["items"][0]["alert_status"] == "Open"
    assert payload["items"][0]["created_at"].endswith("Z")

    export_params = {key: value for key, value in params.items() if key not in {"page", "page_size"}}
    csv_response = reports_client.get("/api/incidents/export.csv", params=export_params)
    assert csv_response.status_code == 200
    rows = list(csv.reader(StringIO(csv_response.content.decode("utf-8-sig"))))
    assert rows[0] == ["Event ID", "Timestamp (UTC)", "Camera", "Zone", "Event type", "Details", "Alert status", "Frame"]
    assert len(rows) == 2
    assert rows[1][2:7] == ["Camera North", "Assembly", "Restricted-zone entry", "Unauthorized entry", "Open"]

    only_next_page = reports_client.get("/api/incidents", params={"page": 2, "page_size": 1})
    assert only_next_page.json()["total"] == 3
    assert only_next_page.json()["items"][0]["event_type"] == "Restricted-zone entry"


def test_report_summary_and_pdf_include_counts_risk_and_simulation_notice(reports_client: TestClient) -> None:
    summary = reports_client.get(
        "/api/reports/summary",
        params={"start": "2026-10-04T00:00:00Z", "end": "2026-10-05T00:00:00Z"},
    )
    assert summary.status_code == 200
    assert summary.json()["total_incidents"] == 2
    assert summary.json()["by_type"] == [
        {"name": "Crowding threshold", "count": 1},
        {"name": "Restricted-zone entry", "count": 1},
    ]
    assert summary.json()["includes_simulated"] is True
    assert len(summary.json()["zone_risks"]) == 2

    pdf_response = reports_client.get("/api/reports/pdf", params={"period": "day", "report_date": "2026-10-04"})
    assert pdf_response.status_code == 200
    assert pdf_response.headers["content-type"] == "application/pdf"
    assert pdf_response.content.startswith(b"%PDF")
    assert len(BytesIO(pdf_response.content).read()) > 500


def test_report_summary_rejects_empty_range(reports_client: TestClient) -> None:
    response = reports_client.get(
        "/api/reports/summary",
        params={"start": "2026-10-04T00:00:00Z", "end": "2026-10-04T00:00:00Z"},
    )

    assert response.status_code == 422
