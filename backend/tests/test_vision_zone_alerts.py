import sys
from types import SimpleNamespace

import pytest

from app.main import event_severity
from app import vision
from app.vision import (
    WorkerState,
    _confirmed_observations,
    _emit_event,
    _fire_smoke_observations,
    _model_detections,
    _predict_adapter,
    _ppe_observations,
    camera_capture_source,
    zone_alert_types,
)


class MockCoordinate:
    def __init__(self, values: list[int]) -> None:
        self.values = values

    def tolist(self) -> list[int]:
        return self.values


class MockBox:
    def __init__(self, class_id: int, confidence: float, coordinates: list[int]) -> None:
        self.cls = [class_id]
        self.conf = [confidence]
        self.xyxy = [MockCoordinate(coordinates)]


def mocked_result(*boxes: MockBox):
    return [type("MockResult", (), {"boxes": boxes})()]


def test_laptop_webcam_uses_opencv_device_zero() -> None:
    assert camera_capture_source("webcam", None) == 0
    assert camera_capture_source("stream", "rtsp://example.invalid/stream") == "rtsp://example.invalid/stream"


def test_stream_source_requires_configured_url() -> None:
    with pytest.raises(ValueError, match="no stream URL"):
        camera_capture_source("stream", None)


@pytest.mark.parametrize(
    ("zone_type", "entry", "proximity", "crowding", "expected"),
    [
        ("normal", True, True, False, []),
        ("normal", False, False, True, ["Crowding threshold"]),
        ("restricted", True, True, False, ["Restricted-zone entry"]),
        ("restricted", False, False, True, ["Crowding threshold"]),
        ("hazard_machinery", True, False, False, []),
        ("hazard_machinery", False, True, True, ["Hazard-zone proximity", "Crowding threshold"]),
    ],
)
def test_zone_types_route_entry_proximity_and_crowding_alerts(
    zone_type: str,
    entry: bool,
    proximity: bool,
    crowding: bool,
    expected: list[str],
) -> None:
    assert zone_alert_types(
        zone_type,
        restricted_entry=entry,
        hazard_proximity=proximity,
        crowding=crowding,
    ) == expected


def test_person_events_are_deduplicated_by_zone_person_and_entry() -> None:
    state = WorkerState(key="camera-1", camera_id=1, source_type="webcam")
    events: list[tuple[str, str, str, int | None]] = []
    callback = lambda _camera_id, kind, zone, detail, _evidence, _frame, zone_id: events.append(
        (kind, zone, detail, zone_id)
    )

    assert _emit_event(
        state, callback, "Restricted-zone entry", "Restricted", "Person 7 entered", b"evidence", 3,
        person_id=7, zone_id=4, now=0,
    )
    assert not _emit_event(
        state, callback, "Restricted-zone entry", "Restricted", "Person 7 entered", b"evidence", 6,
        person_id=7, zone_id=4, now=1,
    )
    assert not _emit_event(
        state, callback, "Restricted-zone entry", "Restricted", "Person 8 entered", b"evidence", 6,
        person_id=8, zone_id=4, now=1,
    )
    assert not _emit_event(
        state, callback, "Restricted-zone entry", "Restricted", "Person 7 re-entered", b"evidence", 9,
        person_id=7, zone_id=4, now=2,
    )
    assert _emit_event(
        state, callback, "Restricted-zone entry", "Restricted", "Person 7 re-entered after cooldown", b"evidence", 12,
        person_id=7, zone_id=4, now=30,
    )
    assert not _emit_event(
        state, callback, "Restricted-zone entry", "Restricted", "Person 8 before zone cooldown", b"evidence", 15,
        person_id=8, zone_id=4, now=31,
    )
    assert _emit_event(
        state, callback, "Restricted-zone entry", "Restricted", "Person 8 after zone cooldown", b"evidence", 18,
        person_id=8, zone_id=4, now=60,
    )
    assert len(events) == 3
    assert all(event[3] == 4 for event in events)


def test_restricted_entry_zone_cooldown_handles_flickering_and_missing_track_ids() -> None:
    state = WorkerState(key="camera-1", camera_id=1, source_type="webcam")
    emitted_at: list[float] = []
    current_time = 0.0
    callback = lambda *_args: emitted_at.append(current_time)
    track_ids = [3, None, 31, 3, None, 31]
    frame_times = [0, 2, 7, 11, 16, 29, 30, 34, 42, 59, 60, 67, 88, 90]

    for frame_index, now in enumerate(frame_times):
        current_time = now
        _emit_event(
            state,
            callback,
            "Restricted-zone entry",
            "Restricted",
            f"Flickering track {track_ids[frame_index % len(track_ids)]}",
            b"evidence",
            frame_index,
            person_id=track_ids[frame_index % len(track_ids)],
            zone_id=4,
            now=now,
        )

    assert emitted_at == [0, 30, 60, 90]
    assert all(later - earlier >= 30 for earlier, later in zip(emitted_at, emitted_at[1:]))
    assert state.last_restricted_entry_at["4"] == 90


def test_restricted_entry_cooldown_is_independent_between_zones() -> None:
    state = WorkerState(key="camera-1", camera_id=1, source_type="webcam")
    events: list[int | None] = []
    callback = lambda _camera, _kind, _zone, _detail, _evidence, _frame, zone_id: events.append(zone_id)

    assert _emit_event(state, callback, "Restricted-zone entry", "Zone A", "entry", b"evidence", 1, 3, 4, 0)
    assert _emit_event(state, callback, "Restricted-zone entry", "Zone B", "entry", b"evidence", 2, 3, 5, 1)
    assert events == [4, 5]


def test_restricted_entry_retains_person_cooldown_after_zone_cooldown() -> None:
    state = WorkerState(key="camera-1", camera_id=1, source_type="webcam")
    state.last_restricted_entry_at["4"] = 0
    state.last_event_at["Restricted-zone entry:4:3"] = 29
    events: list[int | None] = []
    callback = lambda _camera, _kind, _zone, _detail, _evidence, _frame, zone_id: events.append(zone_id)

    assert not _emit_event(
        state, callback, "Restricted-zone entry", "Zone A", "same person", b"evidence", 1, 3, 4, 30
    )
    assert _emit_event(
        state, callback, "Restricted-zone entry", "Zone A", "different person", b"evidence", 2, 8, 4, 30
    )
    assert events == [4]


def test_hazard_proximity_uses_person_and_zone_cooldown() -> None:
    state = WorkerState(key="camera-1", camera_id=1, source_type="webcam")
    callback = lambda *_args: None

    assert _emit_event(
        state, callback, "Hazard-zone proximity", "Machine", "Person 3 nearby", b"evidence", 3,
        person_id=3, zone_id=2, now=0,
    )
    assert not _emit_event(
        state, callback, "Hazard-zone proximity", "Machine", "Person 3 nearby", b"evidence", 6,
        person_id=3, zone_id=2, now=29,
    )
    assert _emit_event(
        state, callback, "Hazard-zone proximity", "Machine", "Person 3 nearby", b"evidence", 9,
        person_id=3, zone_id=2, now=30,
    )
    assert _emit_event(
        state, callback, "Hazard-zone proximity", "Machine", "Person 3 nearby", b"evidence", 12,
        person_id=3, zone_id=5, now=31,
    )


def test_crowding_cooldown_is_per_zone() -> None:
    state = WorkerState(key="camera-1", camera_id=1, source_type="webcam")
    callback = lambda *_args: None

    assert _emit_event(state, callback, "Crowding threshold", "Assembly", "crowded", b"evidence", 3, zone_id=2, now=0)
    assert not _emit_event(state, callback, "Crowding threshold", "Assembly", "crowded", b"evidence", 6, zone_id=2, now=29)
    assert _emit_event(state, callback, "Crowding threshold", "Assembly", "crowded", b"evidence", 9, zone_id=5, now=29)
    assert _emit_event(state, callback, "Crowding threshold", "Assembly", "crowded", b"evidence", 12, zone_id=2, now=30)


def test_mocked_ppe_outputs_require_consecutive_frames_and_match_person_regions() -> None:
    state = WorkerState(key="camera-1", camera_id=1, source_type="webcam")
    ppe_names = {0: "Hardhat", 2: "NO-Hardhat", 4: "NO-Safety Vest"}
    detections = _model_detections(
        mocked_result(
            MockBox(0, 0.91, [300, 20, 340, 60]),
            MockBox(2, 0.88, [110, 110, 145, 150]),
            MockBox(4, 0.90, [120, 175, 175, 230]),
        ),
        ppe_names,
        0.5,
    )
    zone = {
        "id": 7,
        "name": "Workshop",
        "shape_type": "rectangle",
        "coordinates": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
    }
    people = [((100, 100, 200, 300), 12, 0, 0.95)]
    observations = _ppe_observations(people, detections, [zone], 400, 400)

    assert {observation[0] for observation in observations} == {"Missing helmet", "Missing vest"}
    assert _confirmed_observations(state, observations, 3) == []
    assert _confirmed_observations(state, observations, 3) == []
    confirmed = _confirmed_observations(state, observations, 3)
    assert {event[0] for event in confirmed} == {"Missing helmet", "Missing vest"}
    assert all(event[2] == 7 and event[4] == 12 for event in confirmed)


def test_no_hardhat_without_any_hardhat_in_frame_is_ignored() -> None:
    detections = _model_detections(
        mocked_result(MockBox(2, 0.99, [110, 110, 145, 150])),
        {0: "Hardhat", 2: "NO-Hardhat"},
        0.5,
    )
    person = [((100, 100, 200, 300), 4, 0, 0.9)]
    assert _ppe_observations(person, detections, [], 400, 400) == []


def test_positive_ppe_boxes_for_the_person_override_overlapping_missing_boxes() -> None:
    detections = _model_detections(
        mocked_result(
            MockBox(0, 0.9, [110, 110, 145, 150]),
            MockBox(2, 0.9, [110, 110, 145, 150]),
            MockBox(7, 0.9, [120, 175, 175, 230]),
            MockBox(4, 0.9, [120, 175, 175, 230]),
        ),
        {0: "Hardhat", 2: "NO-Hardhat", 4: "NO-Safety Vest", 7: "Safety Vest"},
        0.5,
    )
    person = [((100, 100, 200, 300), 4, 0, 0.9)]
    assert _ppe_observations(person, detections, [], 400, 400) == []


def test_mocked_fire_smoke_outputs_apply_confidence_and_zone_cooldown_identity() -> None:
    state = WorkerState(key="camera-1", camera_id=1, source_type="webcam")
    detections = _model_detections(
        mocked_result(
            MockBox(0, 0.8, [100, 100, 160, 160]),
            MockBox(1, 0.9, [200, 100, 260, 170]),
            MockBox(1, 0.4, [270, 100, 300, 150]),
        ),
        {0: "smoke", 1: "fire"},
        0.5,
    )
    zone = {
        "id": 3,
        "name": "Paint booth",
        "shape_type": "rectangle",
        "coordinates": {"x": 0.0, "y": 0.0, "width": 0.7, "height": 1.0},
    }
    observations = _fire_smoke_observations(detections, [zone], 400, 400)
    assert {observation[0] for observation in observations} == {"Smoke detected", "Fire detected"}
    assert all(observation[2] == 3 for observation in observations)
    assert _confirmed_observations(state, observations, 2) == []
    assert len(_confirmed_observations(state, observations, 2)) == 2


def test_ppe_is_deduplicated_per_person_and_fire_per_zone() -> None:
    state = WorkerState(key="camera-1", camera_id=1, source_type="webcam")
    emitted: list[tuple[str, int | None, int | None]] = []
    callback = lambda _camera, kind, _zone, _detail, _evidence, _frame, zone_id: emitted.append(
        (kind, zone_id, _camera)
    )

    assert _emit_event(
        state, callback, "Missing helmet", "Workshop", "Person 4", b"frame", 1,
        person_id=4, zone_id=8, now=0,
    )
    assert not _emit_event(
        state, callback, "Missing helmet", "Workshop", "Person 4 again", b"frame", 2,
        person_id=4, zone_id=8, now=29,
    )
    assert _emit_event(
        state, callback, "Missing helmet", "Workshop", "Person 5", b"frame", 3,
        person_id=5, zone_id=8, now=1,
    )
    assert _emit_event(
        state, callback, "Fire detected", "Workshop", "Fire", b"frame", 4,
        zone_id=8, now=0,
    )
    assert not _emit_event(
        state, callback, "Fire detected", "Workshop", "Fire again", b"frame", 5,
        zone_id=8, now=29,
    )
    assert _emit_event(
        state, callback, "Fire detected", "Workshop", "Fire after cooldown", b"frame", 6,
        zone_id=8, now=30,
    )
    assert len(emitted) == 4


def test_adapter_status_loads_existing_weights_and_reports_missing_models(monkeypatch, tmp_path) -> None:
    ppe_path = tmp_path / "ppe.pt"
    fire_path = tmp_path / "fire_smoke.pt"
    ppe_path.write_bytes(b"mock")
    fire_path.write_bytes(b"mock")
    class_config = tmp_path / "model_classes.json"
    class_config.write_text(
        '{"ppe":{"0":"Hardhat"},"fire_smoke":{"0":"smoke"}}',
        encoding="utf-8",
    )
    loaded_paths: list[str] = []

    class MockModel:
        def __init__(self, path: str) -> None:
            loaded_paths.append(path)

    monkeypatch.setattr(vision, "PPE_MODEL_PATH", ppe_path)
    monkeypatch.setattr(vision, "FIRE_SMOKE_MODEL_PATH", fire_path)
    monkeypatch.setattr(vision, "MODEL_CLASSES_PATH", class_config)
    monkeypatch.setattr(vision, "_adapter_models", {})
    monkeypatch.setattr(vision, "_adapter_class_names", {})
    monkeypatch.setattr(vision, "_adapter_errors", {})
    monkeypatch.setitem(sys.modules, "ultralytics", SimpleNamespace(YOLO=MockModel))

    assert vision.adapter_status() == {"ppe": "Model loaded", "fire_smoke": "Model loaded"}
    assert set(loaded_paths) == {str(ppe_path), str(fire_path)}
    assert vision._adapter_class_names == {"ppe": {0: "Hardhat"}, "fire_smoke": {0: "smoke"}}


def test_adapter_prediction_passes_cpu_threshold_and_returns_mocked_results(monkeypatch) -> None:
    mock_results = mocked_result(MockBox(0, 0.8, [10, 20, 30, 40]))
    received: dict[str, object] = {}

    class MockModel:
        def predict(self, _frame, **kwargs):
            received.update(kwargs)
            return mock_results

    monkeypatch.setattr(vision, "_adapter_models", {"fire_smoke": MockModel()})
    results = _predict_adapter("fire_smoke", object(), 0.6)
    detections = _model_detections(results, {0: "smoke"}, 0.6)

    assert received == {"device": "cpu", "imgsz": 640, "conf": 0.6, "verbose": False}
    assert detections == [("smoke", (10, 20, 30, 40), 0.8)]


@pytest.mark.parametrize(
    ("event_type", "expected_severity"),
    [
        ("Missing helmet", "Medium"),
        ("Missing vest", "Medium"),
        ("Smoke detected", "High"),
        ("Fire detected", "Critical"),
    ],
)
def test_ai_event_severity(event_type: str, expected_severity: str) -> None:
    assert event_severity(event_type) == expected_severity
