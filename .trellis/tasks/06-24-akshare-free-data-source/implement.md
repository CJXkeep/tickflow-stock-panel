# Implementation Plan

## Context To Read Before Coding

- `docs/free-data-source-plan.md`
- `.trellis/tasks/06-24-akshare-free-data-source/prd.md`
- `.trellis/tasks/06-24-akshare-free-data-source/design.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/guides/code-reuse-thinking-guide.md`
- `.trellis/spec/backend/index.md`
- `.trellis/spec/frontend/index.md`

## Ordered Checklist

### 1. Configuration And Dependencies

- Add `akshare` to backend dependencies.
- Add settings:
  - `data_provider`
  - `fallback_provider`
  - `akshare_initial_years`
  - optional timeout/retry fields if useful
- Add `.env.example` entries.

### 2. Provider Layer

- Create `backend/app/datasource/`.
- Add provider normalization helpers.
- Implement AkShare source methods for:
  - stock list / instruments
  - stock daily bars
  - index instruments
  - index daily bars
  - industry data if practical from AkShare stock list or board API

### 3. AkShare Sync Service

- Add `backend/app/services/akshare_sync.py`.
- Implement:
  - `sync_instruments(data_dir)`
  - `sync_daily(repo, years, on_chunk_done=None)`
  - `sync_index(repo, years)`
- Use existing repository write methods.
- Preserve old data on failures.
- Return counts and failure summaries.

### 4. Capability Integration

- Make capability detection provider-aware.
- In `DATA_PROVIDER=akshare`, return static daily-bar capabilities and label such as `AkShare`.
- Avoid TickFlow probes in AkShare mode.
- Keep TickFlow branch unchanged.
- Fix backend realtime permission checks so `AkShare` or any unknown provider label cannot enable realtime polling.
- Prefer capability/provider checks over tier-label parsing for runtime behavior.

### 5. Pipeline Integration

- In `daily_pipeline.run_now`, branch on provider.
- Keep existing TickFlow path behavior.
- AkShare branch should:
  - sync instruments
  - sync daily bars
  - compute enriched
  - sync index data
  - refresh views
  - invalidate data cache
  - skip unsupported stages
- Prevent scheduled jobs from automatically fetching AkShare data in Phase 1. Manual `/api/pipeline/run` is the supported AkShare sync path.

### 5.5 Provider-Aware Existing Sync Endpoints

- Audit endpoints and Data page controls that use `kline.daily.batch`.
- For AkShare mode, disable or reroute:
  - `/api/kline/extend_history` (disable/reject for Phase 1)
  - `/api/index/sync_daily`
  - `/api/index/daily` live fallback
- Ensure no AkShare-mode control can call TickFlow sync functions just because static daily capabilities are present.

### 6. Settings And API Surface

- Extend `/api/settings` response with provider fields.
- Ensure `/api/capabilities` returns provider-aware capabilities.
- Ensure `/api/pipeline/run` works in AkShare mode.

### 7. Frontend Display And Grey States

- Extend `SettingsState` with provider fields.
- Show current provider on Settings/Data pages.
- Add a small AkShare-mode note in TickFlow key settings.
- Adjust onboarding copy/flow so AkShare users see TickFlow key setup as optional/provider-specific.
- Rely on missing capabilities to grey unsupported realtime/minute/depth/financial controls.
- Do not rely only on `tierRank(caps.label)` for provider-specific controls when a backend preference endpoint also needs enforcement.

### 8. Validation

Run the fastest available checks first:

```powershell
cd backend
uv run python -m compileall app
```

If frontend dependencies are available:

```powershell
cd frontend
pnpm build
```

If AkShare dependency/network is available:

```powershell
$env:DATA_PROVIDER='akshare'
cd backend
uv run python - <<'PY'
from app.config import settings
from app.tickflow.policy import detect_capabilities, tier_label
print(settings.data_provider)
print(tier_label(), detect_capabilities(force=True).to_dict())
PY
```

Manual smoke after implementation:

- Start app in TickFlow default mode and verify no provider regression.
- Start app with `DATA_PROVIDER=akshare`.
- Open Data page.
- Confirm realtime toggle is unavailable and backend rejects/enforces realtime disabled.
- Run manual sync.
- Verify parquet directories receive data.
- Verify Screener can run from enriched data.
- Verify stock daily K chart can load.
- Confirm extend-history/index-sync controls do not call TickFlow in AkShare mode.

## Risky Files

- `backend/app/jobs/daily_pipeline.py`
- `backend/app/tickflow/policy.py`
- `backend/app/api/settings.py`
- `backend/app/config.py`
- `frontend/src/lib/api.ts`
- `frontend/src/pages/Data.tsx`
- `frontend/src/pages/settings/Keys.tsx`

## Rollback Points

- If provider-aware capabilities cause regressions, revert only capability changes and keep AkShare modules unused.
- If pipeline branching becomes too invasive, extract current TickFlow body into `_run_tickflow_now` and isolate `_run_akshare_now`.
- If AkShare full-market sync is too slow for first pass, restrict initial implementation to a smaller chunked universe while preserving the API shape.

## Review Gates Before Starting

- User approves these artifacts.
- `task.py start 06-24-akshare-free-data-source` succeeds.
- Relevant Trellis specs are either curated into context or read inline before edits.
