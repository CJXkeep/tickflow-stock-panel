# Product Navigation

> Sidebar information architecture, product-language rules, and route compatibility.

---

## Product Spine

The primary product experience is a focused trading-research workflow, not a
general-purpose market terminal. Default navigation should express this spine:

1. `/` -> `复盘`
2. `/watchlist` -> `观察池`
3. `/screener` -> `策略`
4. `/backtest` -> `回测`
5. `/monitor` -> `监控`
6. `/data` -> `数据`

`/settings` remains a fixed bottom entry in the layout, not part of the main
navigation arrays.

---

## Primary Vs Context Entries

Keep the sidebar navigation model split into:

- `primaryNav`: entries shown by default.
- `secondaryNav`: context or legacy analysis entries hidden by default.
- dynamic analysis entries from `api.analysisMenus`: context entries hidden by
  default unless the user explicitly configures navigation preferences.

Current context entries include:

- `/limit-ladder`
- `/concept-analysis`
- `/industry-analysis`
- `/stock-analysis`
- `/financials`
- `/indices`
- `/trading`
- `/analysis/:menuId`

Do not remove context routes when reducing sidebar clutter. The first phase of
product trimming hides entry points; it does not delete capabilities.

---

## Preference Compatibility

Navigation preferences are persisted through `nav_order` and `nav_hidden`.
When changing defaults:

- With no saved preferences, show only the primary product spine.
- With saved preferences, respect user intent.
- If saved preferences exist but contain no context-page signal, keep context
  pages hidden so older generic preferences do not suddenly expand the sidebar.
- Menu settings must still list primary, context, and analysis entries so users
  can restore hidden pages.

Both route ids and dynamic analysis ids may appear in preference arrays. Code
that handles analysis entries should support `/analysis/<id>` and bare `<id>`
forms where existing preference logic already does so.

---

## Product Language

Use the product names consistently in primary UI surfaces:

- `看板` -> `复盘`
- `市场看板` -> `复盘工作台`
- `自选` / `自选股` -> `观察池`
- `监控中心` -> `监控`

Internal code names such as `Watchlist`, `inWatchlist`, or comments describing
legacy storage can remain when renaming would create broad churn. User-visible
text should use the product language unless the domain term is intentionally
technical, such as "自选池回测".

---

## Route Compatibility Checklist

Before finishing a navigation or product-language change:

- [ ] Primary sidebar defaults show only the product spine plus fixed settings.
- [ ] Context routes still exist in `frontend/src/router.tsx`.
- [ ] Menu settings lists context pages and can restore them.
- [ ] Dashboard shell says `复盘工作台` / review-workbench language.
- [ ] Watchlist-facing controls say `观察池`.
- [ ] Monitor-facing page titles and entry labels say `监控`.
- [ ] TypeScript passes with `pnpm exec tsc -b`.

