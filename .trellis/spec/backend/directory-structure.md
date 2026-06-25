# Directory Structure

> Snapshot of how backend code is organized.

---

## Overview

Backend code lives under `backend/app`. Route modules expose FastAPI routers,
services own business workflows, and `tickflow/repository.py` owns the local
data access layer.

The app creates long-lived process services during FastAPI lifespan and stores
them on `app.state`.

---

## Directory Layout

```text
backend/app/
├── main.py                  # FastAPI app, lifespan, routers, SPA fallback
├── config.py                # Settings, frozen/desktop path handling
├── desktop.py               # Desktop entry helpers
├── secrets_store.py         # User secrets and provider settings
├── api/                     # FastAPI routers by domain
├── services/                # Business services and file-backed stores
├── tickflow/                # TickFlow client, capabilities, repository
├── datasource/              # Provider abstraction and AkShare source
├── indicators/              # Indicator and signal computation pipeline
├── strategy/                # Strategy engine, monitor engine, built-ins
├── backtest/                # Backtest engines and strategy/factor logic
└── jobs/                    # Scheduled daily pipeline
```

Tests live under `backend/tests`.

---

## Module Organization

- `api/*.py` modules should be thin HTTP adapters. They parse request models,
  read `request.app.state` when needed, call services/repositories, and return
  JSON-serializable dicts.
- `services/*.py` modules own workflow logic, persisted JSON/Parquet stores,
  and integration behavior.
- `tickflow/repository.py` owns local market-data reads/writes and cache
  management.
- `strategy/builtin/*.py` contains built-in strategy definitions. Add new
  built-ins there unless the strategy is user-generated or AI-generated.
- `config.py` is the only place that should decide desktop/frozen resource and
  writable-data paths.

---

## Naming Conventions

- API modules are named by route/domain: `watchlist.py`, `settings.py`,
  `monitor_rules.py`.
- Services use domain nouns: `quote_service.py`, `pipeline_jobs.py`,
  `preferences.py`.
- Pydantic request models use concise names local to the API module, such as
  `TickflowKeyIn` or `BatchAddRequest`.
- Keep public API route prefixes under `/api/<domain>` unless the route is a
  core health/capability endpoint.

---

## Examples

- `main.py` shows lifespan service wiring and router inclusion.
- `api/settings.py` shows request models, HTTP exceptions, runtime service
  updates, and capability redetection.
- `services/preferences.py` shows merge-write JSON preferences.
- `tickflow/repository.py` shows the Parquet + DuckDB + Polars access pattern.
