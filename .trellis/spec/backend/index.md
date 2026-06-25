# Backend Development Guidelines

> Snapshot of backend conventions for this project.

---

## Overview

The backend is a Python 3.11 FastAPI application. It serves APIs, manages data
sync jobs, stores local Parquet data, exposes market/strategy/backtest services,
and optionally serves the built frontend as a SPA.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Active |
| [Database Guidelines](./database-guidelines.md) | Parquet, DuckDB, Polars, JSON preferences | Active |
| [Error Handling](./error-handling.md) | HTTP exceptions, fallbacks, capability errors | Active |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, validation, tests | Active |
| [Logging Guidelines](./logging-guidelines.md) | Python logging conventions | Active |

---

## Runtime Stack

- FastAPI + Uvicorn
- Pydantic v2 and pydantic-settings
- Polars, DuckDB, PyArrow, optional pandas at service boundaries
- APScheduler for scheduled jobs
- TickFlow SDK and AkShare provider support
- PyInstaller / desktop mode path handling

---

## Validation Commands

Preferred backend checks:

```powershell
uv run ruff check .
uv run pytest
```

When `uv` is unavailable, use the project-local environment command that matches
the current setup, but keep the same intent: lint plus tests.
