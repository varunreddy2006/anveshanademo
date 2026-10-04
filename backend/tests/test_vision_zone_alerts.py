import pytest

from app.vision import WorkerState, _emit_event, camera_capture_source, zone_alert_types


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
