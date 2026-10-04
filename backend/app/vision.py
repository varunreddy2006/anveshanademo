import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from app.core.config import settings


FRAME_SAMPLE_INTERVAL = 3
MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "yolov8n.pt"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PPE_MODEL_PATH = PROJECT_ROOT / "models" / "ppe.pt"
FIRE_SMOKE_MODEL_PATH = PROJECT_ROOT / "models" / "fire_smoke.pt"
MODEL_CLASSES_PATH = PROJECT_ROOT / "config" / "model_classes.json"
EVIDENCE_DIR = Path(__file__).resolve().parents[1] / "evidence"
PPE_CONFIDENCE_THRESHOLD = 0.5

logger = logging.getLogger(__name__)


@dataclass
class WorkerState:
    key: str
    camera_id: int
    source_type: str
    stop_event: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    thread: threading.Thread | None = None
    status: str = "Not connected"
    error: str | None = None
    latest_frame: bytes | None = None
    progress: float = 0
    processed_frames: int = 0
    total_frames: int | None = None
    completed: bool = False
    started_at: float = field(default_factory=time.monotonic)
    last_event_at: dict[str, float] = field(default_factory=dict)
    last_restricted_entry_at: dict[str, float] = field(default_factory=dict)
    last_crowding_event_at: dict[str, float] = field(default_factory=dict)
    confirmation_counts: dict[str, int] = field(default_factory=dict)


_workers: dict[str, WorkerState] = {}
_workers_lock = threading.Lock()
_adapter_models: dict[str, Any] = {}
_adapter_class_names: dict[str, dict[int, str]] = {}
_adapter_errors: dict[str, str] = {}
_adapter_lock = threading.Lock()
_adapter_inference_lock = threading.Lock()


def zone_alert_types(
    zone_type: str,
    *,
    restricted_entry: bool,
    hazard_proximity: bool,
    crowding: bool,
) -> list[str]:
    alerts = []
    if zone_type == "restricted" and restricted_entry:
        alerts.append("Restricted-zone entry")
    if zone_type == "hazard_machinery" and hazard_proximity:
        alerts.append("Hazard-zone proximity")
    if crowding:
        alerts.append("Crowding threshold")
    return alerts


def _inside_zone(point: tuple[int, int], zone: dict[str, Any], width: int, height: int) -> bool:
    coords = zone["coordinates"]
    if zone["shape_type"] == "rectangle":
        left = int(coords["x"] * width)
        top = int(coords["y"] * height)
        right = int((coords["x"] + coords["width"]) * width)
        bottom = int((coords["y"] + coords["height"]) * height)
        return left <= point[0] <= right and top <= point[1] <= bottom

    import cv2
    import numpy as np

    polygon = np.array([(int(item["x"] * width), int(item["y"] * height)) for item in coords], dtype="int32")
    return cv2.pointPolygonTest(polygon, point, False) >= 0


def _zone_distance(point: tuple[int, int], zone: dict[str, Any], width: int, height: int) -> float:
    coords = zone["coordinates"]
    if zone["shape_type"] == "rectangle":
        left = coords["x"] * width
        top = coords["y"] * height
        right = (coords["x"] + coords["width"]) * width
        bottom = (coords["y"] + coords["height"]) * height
        dx = max(left - point[0], 0, point[0] - right)
        dy = max(top - point[1], 0, point[1] - bottom)
        return (dx * dx + dy * dy) ** 0.5

    import cv2
    import numpy as np

    polygon = np.array([(int(item["x"] * width), int(item["y"] * height)) for item in coords], dtype="int32")
    distance = cv2.pointPolygonTest(polygon, point, True)
    return 0.0 if distance >= 0 else abs(distance)


def _zone_pixels(zone: dict[str, Any], width: int, height: int) -> list[tuple[int, int]]:
    coords = zone["coordinates"]
    if zone["shape_type"] == "rectangle":
        left = int(coords["x"] * width)
        top = int(coords["y"] * height)
        right = int((coords["x"] + coords["width"]) * width)
        bottom = int((coords["y"] + coords["height"]) * height)
        return [(left, top), (right, top), (right, bottom), (left, bottom)]
    return [(int(point["x"] * width), int(point["y"] * height)) for point in coords]


def _read_model_class_names() -> dict[str, dict[int, str]]:
    with MODEL_CLASSES_PATH.open(encoding="utf-8") as class_file:
        raw_names = json.load(class_file)
    if not isinstance(raw_names, dict):
        raise ValueError("Model class configuration must be a JSON object")
    class_names: dict[str, dict[int, str]] = {}
    for model_name in ("ppe", "fire_smoke"):
        raw_model_names = raw_names.get(model_name)
        if not isinstance(raw_model_names, dict):
            raise ValueError(f"Model class configuration is missing '{model_name}'")
        try:
            class_names[model_name] = {
                int(class_id): str(label) for class_id, label in raw_model_names.items()
            }
        except (TypeError, ValueError) as error:
            raise ValueError(f"Invalid class ID in '{model_name}' model configuration") from error
    return class_names


def _ensure_adapter_models() -> None:
    model_paths = {"ppe": PPE_MODEL_PATH, "fire_smoke": FIRE_SMOKE_MODEL_PATH}
    with _adapter_lock:
        for model_name, path in model_paths.items():
            if not path.is_file():
                _adapter_models.pop(model_name, None)
                _adapter_class_names.pop(model_name, None)
                _adapter_errors.pop(model_name, None)
    pending = {name: path for name, path in model_paths.items() if path.is_file()}
    if not pending:
        return
    with _adapter_lock:
        try:
            class_names = _read_model_class_names()
        except (OSError, json.JSONDecodeError, ValueError) as error:
            for model_name in pending:
                _adapter_errors[model_name] = str(error)
                logger.error("Unable to load model class configuration: %s", error)
            return
        try:
            from ultralytics import YOLO
        except ImportError as error:
            for model_name in pending:
                _adapter_errors[model_name] = str(error)
            logger.exception("Ultralytics is required to load optional vision models")
            return

        for model_name, path in pending.items():
            if model_name in _adapter_models or model_name in _adapter_errors:
                continue
            try:
                _adapter_models[model_name] = YOLO(str(path))
                _adapter_class_names[model_name] = class_names[model_name]
            except Exception as error:
                _adapter_errors[model_name] = str(error)
                logger.exception("Unable to load %s model weights from %s", model_name, path)


def _predict_adapter(model_name: str, frame: Any, confidence: float) -> list[Any]:
    model = _adapter_models.get(model_name)
    if model is None:
        return []
    try:
        with _adapter_inference_lock:
            return model.predict(
                frame,
                device="cpu",
                imgsz=640,
                conf=confidence,
                verbose=False,
            )
    except Exception as error:
        with _adapter_lock:
            _adapter_errors[model_name] = str(error)
            _adapter_models.pop(model_name, None)
        logger.exception("%s model inference failed; disabling this adapter", model_name)
        return []


def _model_detections(
    results: list[Any],
    class_names: dict[int, str],
    confidence_threshold: float,
) -> list[tuple[str, tuple[int, int, int, int], float]]:
    if not results or getattr(results[0], "boxes", None) is None:
        return []
    detections = []
    for box in results[0].boxes:
        confidence = float(box.conf[0])
        class_id = int(box.cls[0])
        label = class_names.get(class_id)
        if label is None or confidence < confidence_threshold:
            continue
        coordinates = tuple(int(value) for value in box.xyxy[0].tolist())
        detections.append((label, coordinates, confidence))
    return detections


def _overlaps(
    first: tuple[float, float, float, float],
    second: tuple[float, float, float, float],
) -> bool:
    return min(first[2], second[2]) > max(first[0], second[0]) and min(first[3], second[3]) > max(first[1], second[1])


def _person_zone(
    box: tuple[int, int, int, int],
    zones: list[dict[str, Any]],
    width: int,
    height: int,
) -> tuple[str, int | None]:
    center = ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2)
    for zone in zones:
        if _inside_zone(center, zone, width, height):
            return str(zone["name"]), int(zone["id"])
    return "Camera area", None


def _ppe_observations(
    people: list[tuple[tuple[int, int, int, int], int | None, int, float]],
    detections: list[tuple[str, tuple[int, int, int, int], float]],
    zones: list[dict[str, Any]],
    width: int,
    height: int,
) -> list[tuple[str, str, int | None, str, int | None, str]]:
    hardhats = [box for label, box, _ in detections if label.casefold() == "hardhat"]
    missing_hardhats = [box for label, box, _ in detections if label.casefold() == "no-hardhat"]
    vests = [box for label, box, _ in detections if label.casefold() == "safety vest"]
    missing_vests = [box for label, box, _ in detections if label.casefold() == "no-safety vest"]
    observations = []
    for person_box, track_id, person_index, _ in people:
        left, top, right, bottom = person_box
        person_height = bottom - top
        head = (left, top, right, top + person_height * 0.3)
        torso = (left, top + person_height * 0.3, right, top + person_height * 0.8)
        zone_name, zone_id = _person_zone(person_box, zones, width, height)
        identity = track_id if track_id is not None else person_index
        has_person_hardhat = any(_overlaps(head, box) for box in hardhats)
        if hardhats and not has_person_hardhat and any(
            _overlaps(head, box) for box in missing_hardhats
        ):
            observations.append(
                (
                    "Missing helmet",
                    zone_name,
                    zone_id,
                    f"Person {identity} detected without a hardhat",
                    track_id,
                    f"Missing helmet:{zone_id}:{identity}",
                )
            )
        has_person_vest = any(_overlaps(torso, box) for box in vests)
        if not has_person_vest and any(_overlaps(torso, box) for box in missing_vests):
            observations.append(
                (
                    "Missing vest",
                    zone_name,
                    zone_id,
                    f"Person {identity} detected without a safety vest",
                    track_id,
                    f"Missing vest:{zone_id}:{identity}",
                )
            )
    return observations


def _fire_smoke_observations(
    detections: list[tuple[str, tuple[int, int, int, int], float]],
    zones: list[dict[str, Any]],
    width: int,
    height: int,
) -> list[tuple[str, str, int | None, str, int | None, str]]:
    observations = []
    event_names = {"smoke": "Smoke detected", "fire": "Fire detected"}
    for label, box, confidence in detections:
        event_type = event_names.get(label.casefold())
        if event_type is None:
            continue
        zone_name, zone_id = _person_zone(box, zones, width, height)
        observations.append(
            (
                event_type,
                zone_name,
                zone_id,
                f"{label.title()} detected with confidence {confidence:.2f}",
                None,
                f"{event_type}:{zone_id}",
            )
        )
    return observations


def _confirmed_observations(
    state: WorkerState,
    observations: list[tuple[str, str, int | None, str, int | None, str]],
    required_frames: int,
) -> list[tuple[str, str, int | None, str, int | None]]:
    current = {observation[5]: observation for observation in observations}
    for key in list(state.confirmation_counts):
        if key not in current:
            del state.confirmation_counts[key]
    confirmed = []
    for key, observation in current.items():
        count = state.confirmation_counts.get(key, 0) + 1
        state.confirmation_counts[key] = count
        if count >= required_frames:
            confirmed.append(observation[:5])
    return confirmed


def _draw_model_detections(
    frame: Any,
    detections: list[tuple[str, tuple[int, int, int, int], float]],
    color: tuple[int, int, int],
) -> None:
    import cv2

    for label, (left, top, right, bottom), confidence in detections:
        cv2.rectangle(frame, (left, top), (right, bottom), color, 2)
        cv2.putText(
            frame,
            f"{label} {confidence:.2f}",
            (left, max(20, top - 7)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            color,
            2,
        )


def get_worker(key: str) -> WorkerState | None:
    with _workers_lock:
        return _workers.get(key)


def camera_capture_source(source_type: str, source_url: str | None) -> int | str:
    if source_type == "webcam":
        return 0
    if not source_url:
        raise ValueError("This camera has no stream URL")
    return source_url


def worker_snapshot(state: WorkerState) -> dict[str, Any]:
    with state.lock:
        return {
            "key": state.key,
            "camera_id": state.camera_id,
            "source_type": state.source_type,
            "status": state.status,
            "error": state.error,
            "progress": round(state.progress, 1),
            "processed_frames": state.processed_frames,
            "total_frames": state.total_frames,
            "completed": state.completed,
            "running": state.thread is not None and state.thread.is_alive() and not state.stop_event.is_set(),
            "has_frame": state.latest_frame is not None,
        }


def camera_worker(camera_id: int) -> WorkerState | None:
    with _workers_lock:
        candidates = [
            state
            for state in _workers.values()
            if state.camera_id == camera_id and (state.key == f"camera-{camera_id}" or state.key.startswith("upload-"))
        ]
        return max(candidates, key=lambda state: state.started_at, default=None)


def latest_frame(state: WorkerState) -> bytes | None:
    with state.lock:
        return state.latest_frame


def active_camera_ids() -> set[int]:
    with _workers_lock:
        return {
            worker.camera_id
            for worker in _workers.values()
            if worker.thread is not None and worker.thread.is_alive() and not worker.stop_event.is_set()
        }


def _launch(
    state: WorkerState,
    source: int | str,
    zones: list[dict[str, Any]],
    event_callback: Callable[[int, str, str, str, bytes, int, int | None], None],
    credential_username: str | None = None,
    credential_password: str | None = None,
) -> None:
    thread = threading.Thread(
        target=_run,
        args=(state, source, zones, event_callback, credential_username, credential_password),
        name=f"vision-{state.key}",
        daemon=True,
    )
    state.thread = thread
    thread.start()


def start_camera(
    camera_id: int,
    source_type: str,
    source_url: str | None,
    zones: list[dict[str, Any]],
    event_callback: Callable[[int, str, str, str, bytes, int, int | None], None],
    credential_username: str | None = None,
    credential_password: str | None = None,
) -> WorkerState:
    key = f"camera-{camera_id}"
    source = camera_capture_source(source_type, source_url)

    with _workers_lock:
        existing = _workers.get(key)
        if existing is not None and existing.thread is not None and existing.thread.is_alive():
            raise ValueError("This camera is already processing")
        state = WorkerState(key=key, camera_id=camera_id, source_type=source_type)
        _workers[key] = state
    _launch(state, source, zones, event_callback, credential_username, credential_password)
    return state


def start_upload(
    camera_id: int,
    file_path: str,
    zones: list[dict[str, Any]],
    event_callback: Callable[[int, str, str, str, bytes, int, int | None], None],
) -> WorkerState:
    key = f"upload-{uuid.uuid4().hex}"
    state = WorkerState(key=key, camera_id=camera_id, source_type="upload")
    with _workers_lock:
        _workers[key] = state
    _launch(state, file_path, zones, event_callback)
    return state


def stop_camera(camera_id: int) -> WorkerState | None:
    state = get_worker(f"camera-{camera_id}")
    if state is None:
        return None
    state.stop_event.set()
    if state.thread is not None:
        state.thread.join(timeout=5)
    with state.lock:
        state.status = "Not connected"
    return state


def _emit_event(
    state: WorkerState,
    event_callback: Callable[[int, str, str, str, bytes, int, int | None], None],
    kind: str,
    zone_name: str,
    detail: str,
    evidence: bytes,
    frame_index: int,
    person_id: int | None = None,
    zone_id: int | None = None,
    now: float | None = None,
) -> bool:
    event_time = time.monotonic() if now is None else now
    zone_key = str(zone_id) if zone_id is not None else zone_name
    if kind == "Crowding threshold":
        previous = state.last_crowding_event_at.get(zone_key)
        if previous is not None and event_time - previous < 30:
            return False
        state.last_crowding_event_at[zone_key] = event_time
    else:
        event_key = f"{kind}:{zone_key}:{person_id}" if person_id is not None else f"{kind}:{zone_key}"
        previous = state.last_event_at.get(event_key)
        if previous is not None and event_time - previous < 30:
            return False
        if kind == "Restricted-zone entry":
            zone_previous = state.last_restricted_entry_at.get(zone_key)
            if zone_previous is not None and event_time - zone_previous < 30:
                return False
            state.last_restricted_entry_at[zone_key] = event_time
        state.last_event_at[event_key] = event_time
    event_callback(state.camera_id, kind, zone_name, detail, evidence, frame_index, zone_id)
    return True


def _run(
    state: WorkerState,
    source: int | str,
    zones: list[dict[str, Any]],
    event_callback: Callable[[int, str, str, str, bytes, int, int | None], None],
    credential_username: str | None,
    credential_password: str | None,
) -> None:
    capture = None
    upload_path = Path(source) if state.source_type == "upload" else None
    try:
        import cv2
        import numpy as np
        from ultralytics import YOLO

        if state.source_type == "stream" and credential_username:
            from urllib.parse import quote, urlsplit, urlunsplit

            parsed = urlsplit(str(source))
            hostname = parsed.hostname or ""
            if ":" in hostname and not hostname.startswith("["):
                hostname = f"[{hostname}]"
            host = hostname
            if parsed.port:
                host = f"{host}:{parsed.port}"
            user_info = quote(credential_username, safe="")
            if credential_password:
                user_info += f":{quote(credential_password, safe='')}"
            source = urlunsplit((parsed.scheme, f"{user_info}@{host}", parsed.path, parsed.query, parsed.fragment))

        model_source = str(MODEL_PATH) if MODEL_PATH.is_file() else "yolov8n.pt"
        model = YOLO(model_source)
        _ensure_adapter_models()
        capture = cv2.VideoCapture(source)
        if not capture.isOpened():
            with state.lock:
                state.status = "Error"
                state.error = "Unable to open the selected camera or video source"
            return

        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT)) if state.source_type == "upload" else 0
        with state.lock:
            state.status = "Not connected" if state.source_type == "upload" else "Connected"
            state.total_frames = total or None

        frame_index = 0
        while not state.stop_event.is_set():
            ok, frame = capture.read()
            if not ok:
                if state.stop_event.is_set():
                    break
                if state.source_type == "upload" and frame_index == 0:
                    with state.lock:
                        state.status = "Error"
                        state.error = "The uploaded MP4 contains no readable video frames"
                    return
                if state.source_type != "upload":
                    with state.lock:
                        state.status = "Error"
                        state.error = "The camera stream ended or stopped returning frames"
                    return
                break
            frame_index += 1
            if (frame_index - 1) % FRAME_SAMPLE_INTERVAL != 0:
                if state.source_type == "upload":
                    with state.lock:
                        state.processed_frames = frame_index
                        state.progress = min(100, frame_index * 100 / max(total, 1))
                continue

            height, width = frame.shape[:2]
            detection_frame = frame.copy()
            active_zones = [zone for zone in zones if zone["camera_id"] in (None, state.camera_id)]
            results = model.track(frame, persist=True, classes=[0], device="cpu", imgsz=640, verbose=False)
            result = results[0]
            boxes = result.boxes
            people: list[tuple[tuple[int, int, int, int], int | None, int, float]] = []
            if boxes is not None:
                for person_index, box in enumerate(boxes):
                    confidence = float(box.conf[0])
                    xyxy = [int(value) for value in box.xyxy[0].tolist()]
                    track_id = int(box.id[0]) if box.id is not None else None
                    x1, y1, x2, y2 = xyxy
                    center = ((x1 + x2) // 2, (y1 + y2) // 2)
                    people.append(((x1, y1, x2, y2), track_id, person_index, confidence))
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (16, 185, 129), 2)
                    label = f"Person {track_id}" if track_id is not None else "Person"
                    cv2.putText(frame, f"{label} {confidence:.2f}", (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (16, 185, 129), 2)

            for zone in active_zones:
                points = _zone_pixels(zone, width, height)
                polygon = np.array(points, dtype="int32")
                cv2.polylines(frame, [polygon], True, (59, 130, 246), 2)
                cv2.putText(frame, zone["name"], points[0], cv2.FONT_HERSHEY_SIMPLEX, 0.55, (147, 197, 253), 2)

            event_candidates: list[tuple[str, str, int | None, str, int | None]] = []
            for zone in active_zones:
                people_in_zone = 0
                zone_id = int(zone["id"])
                for person_box, track_id, person_index, confidence in people:
                    if confidence < zone["confidence_threshold"]:
                        continue
                    center_x = (person_box[0] + person_box[2]) // 2
                    center_y = (person_box[1] + person_box[3]) // 2
                    center = (center_x, center_y)
                    identity = track_id if track_id is not None else person_index
                    inside = _inside_zone(center, zone, width, height)
                    if inside:
                        people_in_zone += 1
                        if zone.get("zone_type", "normal") == "restricted":
                            event_candidates.append(
                                (
                                    "Restricted-zone entry",
                                    zone["name"],
                                    zone_id,
                                    f"Person {identity} entered {zone['name']}",
                                    track_id,
                                )
                            )
                    elif (
                        zone.get("zone_type", "normal") == "hazard_machinery"
                        and _zone_distance(center, zone, width, height) <= max(20, min(width, height) * 0.04)
                    ):
                        event_candidates.append(
                            (
                                "Hazard-zone proximity",
                                zone["name"],
                                zone_id,
                                f"Person {identity} detected near {zone['name']}",
                                track_id,
                            )
                        )
                if people_in_zone > zone["crowd_threshold"]:
                    event_candidates.append(
                        (
                            "Crowding threshold",
                            zone["name"],
                            zone_id,
                            f"{people_in_zone} people in {zone['name']} (threshold {zone['crowd_threshold']})",
                            None,
                        )
                    )

            adapter_event_observations: list[
                tuple[str, str, int | None, str, int | None, str]
            ] = []
            ppe_detections: list[tuple[str, tuple[int, int, int, int], float]] = []
            fire_smoke_detections: list[tuple[str, tuple[int, int, int, int], float]] = []
            if "ppe" in _adapter_models:
                ppe_results = _predict_adapter("ppe", detection_frame, PPE_CONFIDENCE_THRESHOLD)
                ppe_detections = _model_detections(
                    ppe_results,
                    _adapter_class_names.get("ppe", {}),
                    PPE_CONFIDENCE_THRESHOLD,
                )
                ppe_detections = [
                    detection
                    for detection in ppe_detections
                    if detection[0].casefold()
                    in {"hardhat", "no-hardhat", "safety vest", "no-safety vest"}
                ]
                _draw_model_detections(frame, ppe_detections, (245, 158, 11))
                adapter_event_observations.extend(
                    _ppe_observations(people, ppe_detections, active_zones, width, height)
                )
            if "fire_smoke" in _adapter_models:
                fire_smoke_results = _predict_adapter(
                    "fire_smoke",
                    detection_frame,
                    settings.fire_smoke_confidence_threshold,
                )
                fire_smoke_detections = _model_detections(
                    fire_smoke_results,
                    _adapter_class_names.get("fire_smoke", {}),
                    settings.fire_smoke_confidence_threshold,
                )
                _draw_model_detections(frame, fire_smoke_detections, (37, 99, 235))
                adapter_event_observations.extend(
                    _fire_smoke_observations(fire_smoke_detections, active_zones, width, height)
                )
            event_candidates.extend(
                _confirmed_observations(
                    state,
                    adapter_event_observations,
                    settings.vision_confirmation_frames,
                )
            )
            encoded_ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
            if encoded_ok:
                evidence = encoded.tobytes()
                with state.lock:
                    state.latest_frame = evidence
                    state.processed_frames = frame_index
                    state.progress = min(100, frame_index * 100 / max(total, 1)) if total else 0
                for kind, zone_name, zone_id, detail, person_id in event_candidates:
                    _emit_event(
                        state,
                        event_callback,
                        kind,
                        zone_name,
                        detail,
                        evidence,
                        frame_index,
                        person_id=person_id,
                        zone_id=zone_id,
                    )

        with state.lock:
            state.completed = state.source_type == "upload"
            state.progress = 100 if state.completed else state.progress
            state.status = "Not connected" if state.source_type == "upload" else "Not connected"
    except Exception as error:
        with state.lock:
            state.status = "Error"
            state.error = str(error)
    finally:
        if capture is not None:
            capture.release()
        if upload_path is not None:
            upload_path.unlink(missing_ok=True)


def save_evidence(contents: bytes) -> str:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.jpg"
    (EVIDENCE_DIR / filename).write_bytes(contents)
    return filename


def get_evidence_path(filename: str) -> Path:
    return EVIDENCE_DIR / filename


def adapter_status() -> dict[str, str]:
    _ensure_adapter_models()
    return {
        "ppe": "Model loaded" if "ppe" in _adapter_models else "AI model unavailable",
        "fire_smoke": (
            "Model loaded" if "fire_smoke" in _adapter_models else "AI model unavailable"
        ),
    }


def upload_status(job_id: str) -> dict[str, Any] | None:
    state = get_worker(f"upload-{job_id}")
    return worker_snapshot(state) if state is not None else None


def upload_frame(job_id: str) -> bytes | None:
    state = get_worker(f"upload-{job_id}")
    return latest_frame(state) if state is not None else None
