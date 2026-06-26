# Add AkShare Free Data Source Mode

## Goal

Add a free, low-real-time-requirement AkShare data source mode while preserving the existing TickFlow functionality.

The first release should let a user run the project as a local A-share research workstation without a TickFlow key:

- sync stock instruments
- sync recent daily bars
- sync index daily bars
- compute enriched indicators
- run screeners
- view daily K lines
- run basic backtests

## User Value

The user wants a free data path because they do not want to use TickFlow and do not require strong real-time behavior. The project should remain useful for daily after-market analysis and strategy research.

Existing TickFlow users must not lose current paid/free capabilities.

## Confirmed Facts

- Existing TickFlow integration is broad: startup capability detection, pipeline sync, settings UI, realtime quote service, index sync, financial sync, depth service, and frontend capability gating.
- Existing storage is favorable for replacement: Parquet + DuckDB + Polars, with daily bars partitioned by date.
- The core enriched pipeline can work from daily OHLCV data.
- The first AkShare phase should preserve existing UI and feature locations, but mark unsupported provider-specific features as unavailable.
- Phase 1 decisions have been documented in `docs/free-data-source-plan.md`.

## Requirements

### Provider Selection

- Add `DATA_PROVIDER` configuration.
- Supported values for this task:
  - `tickflow`
  - `akshare`
- Default must preserve current behavior by using `tickflow`.
- AkShare mode must not remove or break TickFlow code paths.

### AkShare Phase 1 Scope

AkShare mode must support:

- stock instrument sync
- internal symbols normalized to `000001.SZ`, `600000.SH`, `8xxxxx.BJ`
- recent 3 years of A-share daily bars by default
- forward-adjusted daily prices for first phase
- index instrument and daily bar sync
- industry field when reasonably available
- enriched indicator recomputation from local data
- Screener strategy execution from enriched data
- stock daily K-line display from local data
- basic backtest from local enriched data

### Unsupported In AkShare Phase 1

The following must remain unavailable or greyed out in AkShare mode:

- realtime quotes
- minute K
- depth / five-level order book
- financial sync and financial pages
- concept data
- limit-up pool / true-false sealed-board correction
- startup-time automatic network sync

### Sync Behavior

- AkShare network sync should only run when manually triggered from the data pipeline path.
- Scheduled pipeline jobs must not automatically fetch AkShare data in Phase 1.
- AkShare Phase 1 should use the main data-page manual sync only. Extend-history controls must be disabled in AkShare mode for this task.
- Failed AkShare sync batches must not clear old local data.
- Sync should write successful batches incrementally where feasible.
- Failure details should be logged and surfaced enough for diagnosis.

### Capability Behavior

- Continue using the existing `CapabilitySet`.
- In TickFlow mode, capabilities continue to mean detected TickFlow subscription capability.
- In AkShare mode, capabilities mean static capabilities provided by the current data source.
- AkShare Phase 1 should expose daily K capabilities only; unsupported features should naturally grey out via missing capabilities.
- Runtime gates must not infer realtime availability from `tier_label` alone. AkShare labels must not accidentally enable realtime quote polling.
- Existing manual endpoints that currently use TickFlow behind a daily K capability must become provider-aware or explicitly disabled in AkShare mode.

### UI Behavior

- First phase must not rename the product or replace branding.
- Settings/Data pages should show the current data source.
- TickFlow-specific controls may remain visible, but AkShare mode should make it clear they apply only to TickFlow or are unsupported by the current provider.
- Onboarding must not force an AkShare user through TickFlow-key language as the only obvious path.

## Acceptance Criteria

- [x] With default config, TickFlow mode behaves as before.
- [x] With `DATA_PROVIDER=akshare`, `/api/capabilities` returns AkShare static daily-bar capabilities and does not probe TickFlow.
- [x] With `DATA_PROVIDER=akshare`, settings API reports the current provider.
- [x] With `DATA_PROVIDER=akshare`, manual pipeline sync writes instruments, daily bars, enriched daily data, index instruments, and index daily data when AkShare is available.
- [x] With `DATA_PROVIDER=akshare`, unsupported capabilities such as realtime, minute K, depth, and financial are absent or unavailable.
- [x] With `DATA_PROVIDER=akshare`, realtime quote polling cannot be enabled through backend or frontend tier-label fallbacks.
- [x] With `DATA_PROVIDER=akshare`, scheduled jobs do not perform automatic AkShare network sync in Phase 1.
- [x] With `DATA_PROVIDER=akshare`, direct sync endpoints such as extend-history and index sync do not accidentally call TickFlow.
- [x] With `DATA_PROVIDER=akshare`, extend-history UI/API is disabled or rejected for Phase 1 instead of fetching additional AkShare history.
- [x] With `DATA_PROVIDER=akshare`, onboarding and settings make it clear TickFlow key setup is optional / provider-specific.
- [x] Old local data is preserved when an AkShare sync batch fails.
- [x] Internal persisted symbols use the existing normalized symbol format.
- [x] Screener and daily K-line read from the local AkShare-backed enriched data.
- [x] Basic backtest can run from the local AkShare-backed enriched data.
- [x] TickFlow-specific code paths remain intact and selectable by `DATA_PROVIDER=tickflow`.

## Out Of Scope

- Full realtime AkShare quote integration
- Minute K synchronization
- Depth/five-level order book support
- Financial statements
- Concept analysis
- Limit-up pool integration
- Automatic startup sync
- Product rebranding
- Removing TickFlow code

## Open Questions

None blocking Phase 1. If AkShare endpoint behavior differs during implementation, document the exact limitation in `design.md` or a research note before changing scope.
