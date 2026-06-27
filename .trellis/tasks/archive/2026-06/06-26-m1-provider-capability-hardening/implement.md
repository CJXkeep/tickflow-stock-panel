# M1 Provider 与能力边界硬化 Implementation Plan

## Pre-Development Checklist

- Read backend specs before backend edits:
  - `.trellis/spec/backend/index.md`
  - `.trellis/spec/backend/error-handling.md`
  - `.trellis/spec/backend/quality-guidelines.md`
- Read frontend specs before frontend edits:
  - `.trellis/spec/frontend/index.md`
  - `.trellis/spec/frontend/component-guidelines.md`
  - `.trellis/spec/frontend/type-safety.md`
  - `.trellis/spec/frontend/state-management.md`
- Re-read project docs:
  - `docs/开发路书.md`
  - `docs/数据源与能力门控契约.md`

## Ordered Checklist

1. Capability limits schema
   - Extend backend `CapabilityLimits`.
   - Preserve new fields in YAML parsing, probing defaults, tier override, JSON cache read/write.
   - Bump capability cache schema version.
   - Extend frontend `CapabilityLimits` type.

2. TickFlow/AkShare limits data
   - Add quote realtime interval metadata to `tiers.yaml`.
   - Add depth polling interval metadata to `tiers.yaml`.
   - Add minute max history metadata to `tiers.yaml`.
   - Keep AkShare static capset daily-only.

3. Backend gates
   - Refactor `QuoteService` realtime allowed and interval clamp to use capability limits.
   - Refactor `DepthService._compute_interval()` to use depth capability interval limits.
   - Refactor `extend_minute_history` to use `max_history_days`.
   - Ensure settings endpoints return the same backend-derived bounds.

4. Frontend gates
   - Replace realtime/depth/long-history feature gates that call `tierRank()` with capability predicates.
   - Update `DepthConfigCard` to display capability-derived range.
   - Keep tier helpers only for badges/styles or remove exports if unused.

5. Provider stage matrix
   - Add backend matrix owner under `backend/app/datasource/`.
   - Wire pipeline/data/settings consumer to the same matrix where practical.
   - Add AkShare unsupported/manual-only statuses for realtime/minute/depth/financial.

6. Tests and validation
   - Add/adjust backend tests for capability serialization and provider limits.
   - Run backend lint/tests or targeted pytest.
   - Run frontend typecheck/build command used by this repo.
   - Search for remaining `tierRank(` and `tier_label()` true gate usages; classify any remaining usage as display/diagnostic or add to follow-up.

## Validation Commands

Preferred:

```powershell
cd backend
uv run ruff check .
uv run pytest
```

```powershell
cd frontend
pnpm typecheck
pnpm build
```

If repo scripts differ or dependencies are unavailable, run the nearest targeted checks and record the limitation in the final report.

## Risky Files / Rollback Points

- `backend/app/tickflow/policy.py`: capability cache version and YAML parsing. Roll back as a unit with `capabilities.py`.
- `backend/app/services/quote_service.py`: affects realtime polling startup and user preference clamp.
- `backend/app/services/depth_service.py`: affects live depth polling interval.
- `backend/app/api/kline.py`: affects long minute-history jobs.
- `frontend/src/lib/capability-labels.tsx`: removing gate usage can affect multiple UI surfaces.

## Review Gates Before Start

- User confirms the recommended scope includes `QuoteService` and realtime UI gates discovered during code survey.
- User confirms whether provider stage matrix should be fully surfaced in the Data page in this same M1 task, or whether backend matrix + one consumer is enough for the first slice.
