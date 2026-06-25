# Hook Guidelines

> Snapshot of hook usage in the frontend.

---

## Overview

Hooks are used for React Query server state, shared mutations, streaming quote
updates, and route-local UI state. Prefer existing shared hooks before adding
new `useQuery` calls in pages.

---

## Custom Hook Patterns

- Shared queries live in `frontend/src/lib/useSharedQueries.ts`.
- Shared mutations live in `frontend/src/lib/useSharedMutations.ts`.
- Long-running or cross-page behavior gets a named hook in `frontend/src/lib`,
  such as `useQuoteStream`, `useFinancials`, or `useStrategyPool`.
- Feature-local hooks may live next to the feature when reuse is limited, such
  as `pages/backtest/charts/useECharts.ts`.

Keep hook names action-oriented and explicit:

- `useCapabilities`
- `useSettings`
- `usePreferences`
- `useQuoteStatus`
- `useToggleRealtimeQuotes`

---

## Data Fetching

React Query is the server-state layer. Use keys from `QK` in
`frontend/src/lib/queryKeys.ts`.

Rules:

- Read server state through `useQuery`.
- Mutate through `useMutation`, then invalidate or update the affected `QK`
  cache.
- Use `placeholderData` or `staleTime` deliberately for quote/chart surfaces
  where flicker matters.
- SSE quote events should invalidate relevant queries; do not add page-level
  polling unless the data has no stream signal.
- API calls should go through `api` from `frontend/src/lib/api.ts`, not direct
  `fetch` inside pages.

---

## Naming Conventions

- Hooks must start with `use`.
- Shared hooks should hide endpoint details from page components.
- Mutation hooks should name the user action, not the HTTP method.
- Query hooks may accept an optional `opts` object for `enabled`,
  `staleTime`, or `refetchInterval` instead of positional booleans.

---

## Common Mistakes

- Duplicating the same `useQuery` call across multiple pages instead of adding
  a shared hook.
- Mutating preferences without invalidating `QK.preferences`.
- Calling `api` directly inside a deeply nested reusable component when the
  parent already owns the data flow.
- Adding polling for live quote data instead of relying on SSE invalidation.
