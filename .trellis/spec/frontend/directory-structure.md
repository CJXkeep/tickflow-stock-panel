# Directory Structure

> Snapshot of how frontend code is organized in this project.

---

## Overview

The frontend is a Vite + React + TypeScript application under
`frontend/src`. It is organized by route-level pages, shared components, and
shared library modules.

Use existing folders before creating new ones. Add a new folder only when the
feature has multiple related files or a clear domain boundary.

---

## Directory Layout

```text
frontend/src/
├── main.tsx                 # React entrypoint
├── router.tsx               # React Router route tree and compatibility routes
├── index.css                # Tailwind and project tokens
├── components/              # Shared UI and domain components
│   ├── data/                # Data page panels and settings controls
│   ├── ext-data/            # Extension data dialogs and panels
│   ├── financials/          # Financial search/detail components
│   ├── monitor/             # Monitor rule editor components
│   ├── screener/            # Strategy/screener components
│   ├── signals/             # Custom signal UI
│   └── stock-table/         # Shared stock table primitives
├── lib/                     # API client, query hooks, formatting, storage, models
├── pages/                   # Route-level pages
│   ├── backtest/            # Backtest sub-pages, charts, modal components
│   └── settings/            # Settings tab panels
└── vite-env.d.ts
```

---

## Module Organization

- Put route components in `frontend/src/pages`.
- Put settings tab panels in `frontend/src/pages/settings`.
- Put reusable feature components in `frontend/src/components/<domain>`.
- Put shared data access in `frontend/src/lib/api.ts`.
- Put React Query keys in `frontend/src/lib/queryKeys.ts`.
- Put shared query/mutation hooks in `useSharedQueries.ts` and
  `useSharedMutations.ts`.
- Put formatting, column models, and local storage helpers in `frontend/src/lib`.

For large route features, use a page folder under `pages/<feature>/` when the
route has charts, modal components, or multiple sub-views. `pages/backtest` is
the current example.

---

## Naming Conventions

- React component files use PascalCase, for example `PageHeader.tsx`.
- Hooks use `use*.ts` or live beside their feature when tightly scoped.
- Shared utility modules use kebab-case or lower camel case matching the
  existing file family, for example `queryKeys.ts`, `stock-table.ts`,
  `watchlist-columns.ts`.
- Route paths are defined in `router.tsx`; sidebar labels are defined in
  `Layout.tsx` and menu settings. Do not infer routes from filenames.
- Keep backend API names stable even when product-facing labels change.

---

## Examples

- `frontend/src/components/stock-table` is the shared stock table foundation.
- `frontend/src/pages/backtest` is the pattern for a route with sub-pages,
  charts, and modal components.
- `frontend/src/lib/api.ts` is the single typed API client surface.
- `frontend/src/components/Layout.tsx` owns the application shell and sidebar.
