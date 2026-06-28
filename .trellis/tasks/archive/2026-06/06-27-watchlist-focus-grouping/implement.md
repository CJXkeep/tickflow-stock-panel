# 观察池同步范围与分组 Implementation Plan

## Pre-Development Checklist

- Read backend specs:
  - `.trellis/spec/backend/index.md`
  - `.trellis/spec/backend/database-guidelines.md`
  - `.trellis/spec/backend/error-handling.md`
  - `.trellis/spec/backend/quality-guidelines.md`
- Read frontend specs:
  - `.trellis/spec/frontend/index.md`
  - `.trellis/spec/frontend/component-guidelines.md`
  - `.trellis/spec/frontend/type-safety.md`
  - `.trellis/spec/frontend/state-management.md`

## Ordered Checklist

1. Backend group storage
   - Add group load/save helpers in `watchlist.py`.
   - Add custom group CRUD.
   - Add per-symbol group membership setter.
   - Keep missing group file compatible.

2. Auto group preview
   - Derive exchange groups from symbol suffix.
   - Derive source groups from focus-universe source detail when possible.
   - Derive industry/concept groups from instruments/ext data if suitable columns exist.

3. Focus universe integration
   - Extend preferences with `watchlist_group_mode` and `watchlist_group_ids`.
   - Filter watchlist contribution in `focus_universe.py`.
   - Return `watchlist_groups` preview in detail response.
   - Write the resolved sync range into the observation pool on save.

4. API
   - Add watchlist group routes.
   - Extend settings focus-universe request/response.

5. Frontend
   - Extend API types.
   - Update `FocusUniversePanel` with group mode and group checklist.
   - Keep existing source toggles and manual include/exclude.
   - Add a compact group panel on the Watchlist page for custom groups and membership assignment.

6. Tests and validation
   - Add backend targeted tests for group filtering.
   - Add backend targeted tests for focus range -> watchlist sync and industry/concept auto groups.
   - Run `pnpm exec tsc -b`.
   - Run backend targeted smoke/tests as available.

## Validation Commands

```powershell
cd backend
uv run pytest tests/test_watchlist_groups.py
```

```powershell
cd frontend
pnpm exec tsc -b
```

If `uv` is unavailable because of cache permissions, use project `.venv` or an in-process smoke and record the limitation.

## Rollback Points

- Group file is additive. Removing group integration should restore old behavior because `watchlist_group_mode="all"` keeps current sync semantics.
- Frontend group UI can be hidden while backend group API remains harmless.
