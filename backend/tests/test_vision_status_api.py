from collections.abc import Generator
import threading

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import vision
from app.main import Base, Camera, User, app, get_current_user, get_db


def test_camera_status_and_frame_include_running_uploaded_video(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "vision-status.sqlite3"
    test_engine = create_engine(f"sqlite:///{database_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=test_engine)
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    monkeypatch.setattr(vision, "_workers", {})

    def override_db() -> Generator[Session, None, None]:
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: User(
        id=1,
        full_name="Vision Test",
        email="vision-status@example.invalid",
        password_hash="",
        role="safety_officer",
    )
    try:
        with test_session() as db:
            camera = Camera(name="Test camera", location="Test area")
            db.add(camera)
            db.commit()
            camera_id = camera.id

        upload_worker = vision.WorkerState(
            key="upload-demo-job",
            camera_id=camera_id,
            source_type="upload",
            status="Not connected",
            thread=threading.current_thread(),
            progress=2.0,
            processed_frames=3,
            total_frames=150,
            latest_frame=b"annotated-frame",
        )
        vision._workers[upload_worker.key] = upload_worker

        with TestClient(app) as client:
            status_response = client.get(f"/api/cameras/{camera_id}/vision/status")
            frame_response = client.get(f"/api/cameras/{camera_id}/vision/frame")

        assert status_response.status_code == 200
        assert status_response.json() == {
            "key": "upload-demo-job",
            "camera_id": camera_id,
            "source_type": "upload",
            "status": "Not connected",
            "error": None,
            "progress": 2.0,
            "processed_frames": 3,
            "total_frames": 150,
            "completed": False,
            "running": True,
            "has_frame": True,
        }
        assert frame_response.status_code == 200
        assert frame_response.content == b"annotated-frame"
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()
