# Quality Guidelines

> Snapshot of backend code quality standards.

---

## Overview

Backend changes should keep API routes thin, services cohesive, and repository
data access centralized. The codebase favors pragmatic defensive handling for
local-data gaps and provider failures.

---

## Forbidden Patterns

- Do not add a second database/ORM abstraction for local market data.
- Do not bypass `DataStore` / `KlineRepository` for shared market-data reads and
  writes unless the module owns a separate file-backed store.
- Do not block application startup because an optional scheduler, provider, or
  local parquet view is unavailable.
- Do not log raw secrets.
- Do not return Polars/Pandas objects directly from API routes.
- Do not add direct frontend-facing routes without including the router in
  `main.py`.

---

## Required Patterns

- Define FastAPI routers with a clear `prefix` and `tags`.
- Use Pydantic `BaseModel` classes for non-trivial request bodies.
- Read long-lived services from `request.app.state`.
- Convert dataframes to JSON-safe dict/list outputs at the API boundary.
- Clamp and default preference values in service getter/setter functions.
- Refresh relevant caches after writes that affect repository hot paths.
- Keep capability-gated behavior explicit and return 403 for missing capability
  assertions.

---

## Testing Requirements

Run targeted tests for the changed domain when possible. Existing backend tests
cover backtest correctness and engine behavior under `backend/tests`.

Preferred commands:

```powershell
uv run pytest
uv run ruff check .
```

If a change touches data access, also exercise an empty-data state because fresh
installations often start without parquet files.

---

## Code Review Checklist

- [ ] Route code is a thin adapter over services/repositories.
- [ ] New persisted data has a clear location under `settings.data_dir`.
- [ ] Empty local data and missing optional provider capability are handled.
- [ ] JSON responses contain no `NaN`, `Infinity`, dataframe objects, or
      secrets.
- [ ] Shared DuckDB access is guarded by repository methods.
- [ ] Preference changes preserve backward compatibility for missing keys.
- [ ] Relevant tests or explicit validation commands are recorded.
