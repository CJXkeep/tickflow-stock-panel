# Database Guidelines

> Snapshot of local persistence and query conventions.

---

## Overview

This project does not use a traditional ORM. Local market data is stored as
Parquet files under `settings.data_dir`, queried through Polars hot paths and
DuckDB read-only views. User preferences and secrets are stored as JSON files
under `data/user_data`.

---

## Storage Model

`DataStore` creates the writable data directory and standard subdirectories:

- `kline_daily`
- `kline_daily_enriched`
- `kline_index_daily`
- `kline_index_enriched`
- `kline_minute`
- `adj_factor`
- `financials`
- `instruments`
- `instruments_index`
- `instruments_ext`
- `kline_ext`
- `pools`
- `backtest_results`
- `screener_results`
- `ai_cache`
- `user_data`
- `depth5`

Daily market data is partitioned by date using paths like:

```text
kline_daily/date=YYYY-MM-DD/part.parquet
```

---

## Query Patterns

- Use Polars for hot paths, charts, screener data, signals, intraday data, and
  predicate-pushdown parquet scans.
- Use DuckDB views for cold queries, metadata, stats, and dynamic extension
  joins.
- Access DuckDB through repository methods such as `execute_all` and
  `execute_one` so reads are guarded by the repository lock.
- Keep enriched hot data cached in memory and refresh caches after pipeline
  writes.
- Sanitize `NaN` and infinite values before returning JSON to the frontend.

---

## Writes

- Use repository append/flush methods for market-data writes.
- Daily partition writes should sort by `symbol` and `date`.
- Merge-upsert partition writes should read the existing partition, concat, and
  unique by the natural key.
- User preferences use merge-write JSON through `services/preferences.py`.
- User secrets use `secrets_store.py`; do not store secrets in preferences.

---

## Migrations

There is no database migration framework. Schema evolution is file-format and
reader tolerant:

- Add columns in a backward-compatible way.
- Use DuckDB `union_by_name=true` for parquet view registration.
- Select only existing columns when reading dynamic or older files.
- Provide defaults in service getters when a preference key is absent.

---

## Common Mistakes

- Bypassing repository locks and using the shared DuckDB connection directly
  from multiple threads.
- Treating missing parquet directories as fatal during startup. Startup must
  tolerate empty local data.
- Writing full computed enriched columns to disk when the repository expects the
  narrow storage column set.
- Putting non-sensitive user preferences into `secrets.json` or secrets into
  `preferences.json`.
