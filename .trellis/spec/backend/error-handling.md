# Error Handling

> Snapshot of backend error handling conventions.

---

## Overview

API routes should return clear JSON responses and avoid leaking internal
tracebacks to the frontend. Expected user errors should become `HTTPException`
or structured `{ok: false, error: ...}` responses where the existing endpoint
contract already uses that shape.

Startup and optional background services should log warnings and degrade when
possible instead of preventing the whole app from booting.

---

## Error Types

- `HTTPException` for invalid client input and unsupported operations.
- `CapabilityDenied` for missing TickFlow capabilities; `main.py` maps this to
  HTTP 403 with `detail` and `suggestion`.
- Provider/client exceptions are usually caught at service boundaries and
  logged with `logger.warning`.
- Pydantic models validate request bodies for API routes.

---

## Error Handling Patterns

- Validate user input at the API boundary with Pydantic and explicit checks.
- Return empty result shapes for absent local data when that is a valid state,
  such as no watchlist symbols or no enriched cache.
- Catch provider/network failures in services, log a warning, and return the
  best available degraded result.
- During lifespan startup, optional schedulers and provider-dependent services
  should catch exceptions, log warnings, and continue booting.
- Use `# noqa: BLE001` only when a broad catch is intentionally protecting a
  degraded optional path.

---

## API Error Responses

Common response shapes:

- FastAPI validation errors for malformed request bodies.
- `{"detail": "..."}`
- `{"detail": "...", "suggestion": "..."}`
- Existing settings/key endpoints may return `{"ok": false, "error": "..."}`
  because the frontend already expects that contract.

Do not silently return HTTP 200 for new validation failures unless the existing
endpoint family already uses an `ok` envelope.

---

## Common Mistakes

- Letting `CapabilityDenied` bubble to a 500 instead of 403.
- Treating an empty local data directory as a server error.
- Swallowing errors without logging enough context to identify the provider,
  symbol batch, or service that failed.
- Returning `NaN` or `Infinity` in JSON responses.
