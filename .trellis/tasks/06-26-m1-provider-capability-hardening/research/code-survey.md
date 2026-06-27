# M1 Code Survey

## Source Documents

- `docs/开发路书.md`: M1 asks for capability limits, removal of `tier_label` / `tierRank` gates, and provider stage matrix.
- `docs/数据源与能力门控契约.md`: provider/capability contract, AkShare daily-only static capability behavior, and known design debt.
- `.trellis/tasks/06-24-akshare-free-data-source/prd.md`: prior AkShare provider task; this M1 task should harden boundaries rather than re-add provider scope.

## Current Capability Model

- `backend/app/tickflow/capabilities.py`
  - `CapabilityLimits` currently has `rpm`, `batch`, and `subscribe`.
  - `CapabilitySet.to_dict()` serializes only those fields.
- `backend/app/tickflow/policy.py`
  - Parses the same three fields from `tiers.yaml`.
  - AkShare branch in `detect_capabilities()` returns only `kline.daily.by_symbol` and `kline.daily.batch`.
  - `tier_label()` returns `"AkShare"` for AkShare mode and cache label for TickFlow mode.
- `tiers.yaml`
  - Holds rpm/batch/subscribe per TickFlow tier.
  - No interval or history limit metadata yet.

## Backend Gate Debt

- `backend/app/api/kline.py::extend_minute_history`
  - Uses `tier_label()` to restrict month-unit minute history to Expert.
  - Hard-codes day max 15 and month max 180.
- `backend/app/services/depth_service.py::_compute_interval`
  - Uses `tier_label()` to choose Pro vs Expert interval range.
  - Already uses capability rpm/batch for safe interval calculation.
- `backend/app/services/quote_service.py`
  - Uses `tier_label()` to compute realtime allowed and tier min interval.
  - Has AkShare explicit deny, but still relies on TickFlow label for non-AkShare.
- `backend/app/api/settings.py`
  - Quote interval endpoints return `qs.get_min_interval()` and `qs.MAX_INTERVAL`.
  - Depth polling save endpoint currently only requires `Cap.DEPTH5_BATCH`; clamp is in service/UI, not in this endpoint.

## Frontend Gate Debt

- `frontend/src/lib/api.ts`
  - `CapabilityLimits` lacks new limit fields.
- `frontend/src/lib/capability-labels.tsx`
  - `tierRank()` and `isExpertOrAbove()` are used beyond display.
- `frontend/src/components/data/DepthConfigCard.tsx`
  - Uses `isExpertOrAbove(tierLabel)` to derive `{lo, hi}` and UI text.
- `frontend/src/components/Layout.tsx`
  - Uses `tierRank(caps?.label)` to block realtime toggle.
- `frontend/src/pages/settings/Monitoring.tsx`
  - Uses `tierRank(caps?.label)` for free-tier realtime/depth settings behavior.
- `frontend/src/components/EndpointTestDialog.tsx`
  - Uses `tierRank()` to decide premium endpoint availability.

## Planning Implications

- M1 should include `QuoteService`, even though the roadmap list highlights kline/depth/frontend labels/depth card, because new `realtime_allowed/min_interval/max_interval` limits otherwise lack a real backend consumer.
- `tier_label()` can remain for display, diagnostics, and cache labeling.
- `tierRank()` can remain for UI badge styling only if no true feature gate imports it.
- Provider stage matrix should be backend-owned to avoid frontend and pipeline drifting.
