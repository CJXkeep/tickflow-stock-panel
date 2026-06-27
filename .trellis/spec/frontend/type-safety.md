# Type Safety

> Snapshot of type safety patterns in the frontend.

---

## Overview

The frontend uses TypeScript with API response interfaces concentrated in
`frontend/src/lib/api.ts`. Runtime validation is light; the backend owns most
schema validation through Pydantic, while the frontend uses TypeScript shapes
and defensive optional fields.

---

## Type Organization

- API response and request types live next to `api` methods in `api.ts`.
- Shared table/column types live in focused lib modules such as
  `list-columns.ts`, `stock-table.ts`, `watchlist-columns.ts`, and
  `screener-columns.ts`.
- Component-only prop types should remain local unless another file imports
  them.
- Use literal unions for UI modes, groups, and tabs when the value controls
  rendering behavior.

Examples:

```ts
type NavGroup = 'primary' | 'context'
type ViewMode = 'table' | 'card'
```

---

## Validation

Backend responses may include nullable and optional fields. Frontend types
should model that explicitly with `?` and `| null` where the backend can omit
or null a value.

Use defensive rendering for market data:

- Numeric values may be `null`, `undefined`, `NaN`, or unavailable.
- Optional fields from extension data should not be assumed present.
- Dynamic analysis menu ids may appear as bare ids or `/analysis/<id>` route
  strings in preferences.

---

## Common Patterns

- `as const` for static navigation, tabs, or option lists.
- `Record<string, T>` for dynamic backend dictionaries.
- Index signatures only for genuinely dynamic rows, such as financial or
  extension data records.
- Narrow nullable values before formatting prices, percentages, and dates.
- Keep route ids and API ids as strings; do not create enum migrations unless
  both frontend and backend are updated together.

---

## Forbidden Patterns

- Do not introduce broad `any` for new stable API contracts.
- Do not use type assertions to hide an uncertain backend payload shape.
- Do not duplicate backend payload contracts in multiple components; put shared
  response types in `api.ts` or a focused lib module.
- Do not make product labels the source of truth for behavior. Use ids, routes,
  or explicit literal fields.
- Do not use tier labels or rank helpers for provider capability gates. Use
  `/api/capabilities` fields and capability limit predicates instead.
