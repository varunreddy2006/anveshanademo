# AI Industrial Safety Copilot

This project is being built in phases to create an AI-powered industrial safety monitoring platform.

## Phase 0 status

- Frontend scaffolded with Vite + React + TypeScript + Tailwind CSS + shadcn-style UI primitives.
- Backend scaffolded with FastAPI and SQLAlchemy/Alembic configuration.
- Health endpoint available at `/api/health`.
- PostgreSQL connection settings documented in `.env.example`.

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

- Install PostgreSQL 16 locally and create a database named `safety_copilot`.
- Update `.env` from `.env.example` before running the app.
- Alembic migrations are configured under `backend/alembic`.

## Next phase

Proceed to Phase 1 only after confirming the health checks in Phase 0 and replying with `continue`.
