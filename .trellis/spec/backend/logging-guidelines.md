# Logging Guidelines

> Snapshot of backend logging conventions.

---

## Overview

The backend uses Python's standard `logging` module. `main.py` configures the
root format from `settings.log_level`:

```text
%(asctime)s [%(levelname)s] %(name)s: %(message)s
```

Each module should create a logger with:

```python
logger = logging.getLogger(__name__)
```

---

## Log Levels

- `info`: application lifecycle, cache refresh success, strategy engine load,
  scheduler startup, meaningful completed jobs.
- `warning`: degraded optional services, malformed local JSON, provider/API
  failures that the app can survive, timeout fallbacks.
- `debug`: expected missing local files/views during startup or optional dynamic
  joins that are safe to skip.
- `error` / `exception`: unexpected failures that prevent a requested operation
  from completing and are not already represented by a clear API response.

---

## Structured Logging

Use parameterized logging instead of f-strings:

```python
logger.warning("quote fetch timeout (%.1fs) for %d symbols", timeout_s, len(chunk))
```

Include operational context such as symbol count, provider, date range, job
name, strategy count, or elapsed time. Avoid dumping entire dataframes or large
payloads.

---

## What To Log

- Startup mode, provider, version, and active capability count.
- Cache refresh dates and row counts.
- Scheduler start/stop and job failures.
- Provider failures, timeouts, and degraded fallbacks.
- Malformed local JSON or ignored optional extension joins.

---

## What NOT To Log

- Raw API keys, AI keys, endpoint credentials, or secrets.
- Full user preference files when they may contain operational details.
- Large dataframe contents or complete API payloads.
- Repeated per-row logs in hot paths.
