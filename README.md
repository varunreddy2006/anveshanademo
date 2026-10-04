# AI Industrial Safety Copilot

This project is being built in phases to create an AI-powered industrial safety monitoring platform.

## Phase 0 status

- Frontend scaffolded with Vite + React + TypeScript + Tailwind CSS + shadcn-style UI primitives.
- Backend scaffolded with FastAPI and SQLAlchemy/Alembic configuration.
- Health endpoint available at `/api/health`.
- SQLite is used as the default local database; SQLAlchemy and Alembic are ready to be switched to PostgreSQL later by changing `DATABASE_URL`.

## Quick start

### Frontend

```powershell
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

### Backend

```powershell
cd backend
.\.venv\bin\python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Windows notes

- SQLite is the default local development database for Phase 1.
- Update `.env` from `.env.example` before running the app.
- Alembic migrations are configured under `backend/alembic` and can be pointed to PostgreSQL later by changing `DATABASE_URL`.

## Phase 2 status

- SQLite-backed minimal auth is implemented for registration, login, logout, and two roles: `safety_officer` and `administrator`.
- Backend role checks protect authorized endpoints, and each successful login writes an audit record.
- Frontend auth pages now send real requests to the API and persist the session token locally.

## Phase 3 status

- Authenticated camera CRUD is available at `/api/cameras`; camera stream credentials may be supplied separately and are never included in camera API responses.
- Authenticated zone CRUD is available at `/api/zones`, with normalized rectangular or polygon geometry plus crowd and confidence thresholds.
- The Camera Management and Zones & Thresholds dashboard pages use these API endpoints.
- New resource tables are created automatically on backend startup for the default SQLite database.
- Zone types are `normal`, `restricted`, and `hazard_machinery`; the migration adds `normal` to legacy zones and preserves their existing geometry and thresholds.
- Run `.\.venv\Scripts\python.exe -m alembic upgrade head` from `backend` when upgrading an existing database.
- Rectangular zones can be drawn on a processed camera frame or a selected frame from a local MP4; polygons retain the existing normalized-point editor.

## Phase 5 status

- Live Monitoring starts a real OpenCV capture for webcam device `0` or a configured RTSP/HTTP(S) stream. Connection state is reported as Connected, Not connected, or Error; uploads are labeled as test video and are never presented as a live source.
- Authenticated MP4 upload validates the file type and a 100 MB limit, reports transfer and analysis progress, and presents annotated sampled frames.
- CPU-based YOLOv8n person tracking samples every third frame. Configured zones drive restricted-zone entry, hazard-zone proximity, and crowd-threshold events; each event stores an evidence JPEG and creates an alert.
- PPE and fire/smoke model adapters report `AI model unavailable` until matching `.pt` weights are placed in the repository `models` directory. YOLOv8n weights can be placed there as `yolov8n.pt`; otherwise Ultralytics resolves its pretrained `yolov8n.pt` model.
- Persisted datetimes are normalized as UTC, including legacy naive SQLite timestamps. Events, alerts, and the administrator-only `/api/audit-logs` endpoint serialize timestamps as ISO 8601 with a `Z` suffix; timestamp displays use the browser's local timezone.

Install the backend requirements to enable camera capture, MP4 processing, and YOLO:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

The webcam is the camera visible to the machine running the backend. Camera streams and MP4s are processed by that backend. Uploaded test videos and evidence frames are stored under `backend/uploads` and `backend/evidence` and are excluded from version control.
