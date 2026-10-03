# Architecture

## Overview

The system is split into:

- `frontend/`: user interface (React + Vite + TypeScript + Tailwind CSS)
- `backend/`: API and business logic (FastAPI + SQLAlchemy)
- `docs/`: project documentation

## Phase 0

The base project contains a working frontend shell and a backend health endpoint. This skeleton is designed to support the subsequent authentication, monitoring, AI, and reporting phases.

## Notes

- SQLite is the default local development database for Phase 1 and remains easy to swap later by changing `DATABASE_URL`.
- SQLAlchemy and Alembic are kept in place so the project can move to PostgreSQL without reworking the model layer.
- The frontend calls the backend through the Vite proxy defined in `frontend/vite.config.ts`.
- Secrets stay in `.env` and never in source code.
