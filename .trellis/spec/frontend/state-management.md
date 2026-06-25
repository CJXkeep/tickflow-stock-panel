# State Management

> How state is managed in this project.

---

## Overview

The frontend uses React Query for server state and local React state for
component-only interaction state. Shared query hooks live in
`frontend/src/lib/useSharedQueries.ts`, while shared mutations live in
`frontend/src/lib/useSharedMutations.ts`.

Preferences are server-backed state. UI code should read them through shared
query hooks and invalidate `QK.preferences` after mutation.

---

## State Categories

- Server state: settings, capabilities, preferences, analysis menus, quotes,
  alerts, and page data fetched through `api` and React Query.
- Local state: drag/drop optimistic order, dialog visibility, current tab,
  transient UI toggles, and form draft state.
- Browser-local state: only use localStorage for explicitly local UI affordances
  that are already implemented that way, such as the monitor badge toggle.
- URL state: routes and query parameters remain the compatibility boundary for
  directly accessible pages.

---

## When to Use Global State

Promote state to shared server preferences only when it must survive reloads or
affect multiple routes. Keep single-panel interaction state local.

Navigation visibility and ordering are persisted through:

- `nav_order`
- `nav_hidden`

When default navigation changes, derive effective visibility from preferences
without overwriting saved values automatically.

---

## Server State

Use shared query keys from `QK` and invalidate the affected key after mutation.
For preferences, call the dedicated API method, then invalidate
`QK.preferences`.

When composing derived state from preferences and dynamic server state, such as
analysis menus, keep the derivation deterministic and tolerant of missing
dynamic entries.

---

## Common Mistakes

- Treating "no saved nav preferences" the same as "the user explicitly hid or
  ordered pages." These states have different product meanings.
- Persisting new defaults into user preferences during render. Defaults should
  be derived unless the user takes an explicit settings action.
- Forgetting that dynamic analysis menu ids may be stored as bare ids while
  sidebar routes use `/analysis/<id>`.
