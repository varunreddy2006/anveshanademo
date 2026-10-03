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

## Next phase

Phase 3 will add the first real operational workflows beyond the auth shell.
