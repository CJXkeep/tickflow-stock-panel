# 系统减脂与产品主线收敛 - Design

## Architecture Boundary

This task is a frontend information-architecture change. It should avoid backend migrations and data-model changes.

Primary files:

- `frontend/src/components/Layout.tsx`
- `frontend/src/pages/settings/MenuSettings.tsx`
- `frontend/src/pages/Dashboard.tsx`

Secondary files if needed:

- `frontend/src/router.tsx`
- `frontend/src/lib/api.ts`
- `docs/product-focus-plan.md`

## Current State

The app already has:

- Static builtin navigation in `Layout.tsx`.
- User-controlled `nav_order` and `nav_hidden` preferences.
- `SettingsMenuSettingsPanel` for ordering and hiding pages.
- Routes for all current pages.

This means product trimming can be done by changing default navigation and labels while preserving routes and recovery controls.

## Proposed Design

### 1. Navigation Model

Introduce explicit navigation groups in frontend code:

- Primary workflow entries:
  - `/` -> `复盘`
  - `/watchlist` -> `观察池`
  - `/screener` -> `策略`
  - `/backtest` -> `回测`
  - `/monitor` -> `监控`
  - `/data` -> `数据`

- Secondary/context entries:
  - `/limit-ladder`
  - `/concept-analysis`
  - `/industry-analysis`
  - `/stock-analysis`
  - `/financials`
  - `/indices`
  - `/trading`
  - dynamic `/analysis/:menuId`

Primary entries are shown by default. Secondary entries are hidden by default unless the user explicitly saved `nav_hidden` / `nav_order` preferences that reveal them.

### 2. Backward Compatibility

Do not delete routes. Existing URLs remain valid.

If a user has a custom nav order or hidden list, the implementation should avoid unexpectedly forcing all secondary pages back into the sidebar. The safest behavior:

- With no saved nav preferences, show the new trimmed default.
- With saved preferences, respect the user's choices.
- Menu settings still lists both primary and secondary pages.

### 3. Menu Settings

Menu settings should explain that the product now defaults to a focused workflow, while secondary pages can be restored.

Builtin labels should use product-focused naming:

- `看板` -> `复盘`
- `自选` -> `观察池`
- `监控中心` -> `监控`

Secondary pages should be visibly marked as auxiliary/context pages.

### 4. Dashboard Shell

Rename Dashboard surface language from generic market dashboard to review workbench:

- Page title: `复盘工作台`
- Subtitle or supporting copy should position it as daily market review and next-day planning.
- Existing market cards can remain in Phase 1, but should be grouped under review-oriented labels where practical.

No new backend endpoint is required.

## Trade-offs

- Hiding secondary pages by default reduces clutter but may surprise users who relied on direct sidebar access. Menu settings mitigates this.
- Reshaping Dashboard deeply would better express the new strategy but risks scope creep. Phase 1 should keep layout changes shallow unless explicitly approved.
- Keeping old routes preserves compatibility but leaves some non-focused product surface available. That is acceptable for the first trimming pass.

## Rollback

Rollback is simple:

- Restore the previous nav array in `Layout.tsx`.
- Restore previous builtin labels in `MenuSettings.tsx`.
- Restore previous Dashboard title/copy.

No data migration rollback is needed.
