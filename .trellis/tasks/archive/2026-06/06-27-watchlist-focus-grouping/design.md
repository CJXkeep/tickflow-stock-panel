# 观察池同步范围与分组 Design

## Shape

Keep the existing watchlist storage and API compatible:

```text
watchlist.parquet           # existing symbol list
watchlist_groups.json       # new group metadata and memberships
preferences.focus_universe  # selected group sync config
```

The sync pipeline should continue calling `focus_universe.resolve_focus_universe()`. The resolver becomes group-aware when the watchlist source is enabled.

## Data Model

`watchlist_groups.json`:

```json
{
  "groups": [
    {
      "id": "core",
      "name": "核心观察",
      "kind": "custom",
      "description": "",
      "color": null,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "memberships": {
    "600000.SH": ["core"]
  }
}
```

Group kinds:

- `custom`: user-managed group.
- `auto`: derived group returned in preview only; not persisted as editable membership.

## Auto Groups

First slice derives auto groups without writing them:

- `source:manual`
- `source:strategy`
- `source:monitor`
- `source:alert`
- `exchange:SH`
- `exchange:SZ`
- `exchange:BJ`
- optional `industry:<name>` if local instruments include an industry-like column.
- optional `concept:<name>` if local instruments or ext data include a concept-like column.

If a symbol appears in multiple auto groups, it should be listed in each group; the final sync symbol list is deduped.

## Preference Contract

Extend `preferences.get_focus_universe_config()`:

```json
{
  "sources": { "watchlist": true },
  "watchlist_group_mode": "all",
  "watchlist_group_ids": []
}
```

`all` preserves current behavior.

`selected` means watchlist contributes only symbols that are members of selected custom or auto group ids.

## Backend Changes

- Extend `backend/app/services/watchlist.py` with group helpers:
  - load/save groups
  - list/create/update/delete groups
  - set symbol groups
  - preview custom + auto groups
- Extend `backend/app/api/watchlist.py` with group routes.
- Extend `backend/app/services/preferences.py` focus universe config.
- Extend `backend/app/services/focus_universe.py`:
  - resolve watchlist symbols through selected groups
  - return group preview in `resolve_focus_universe_detail()`
- Extend `backend/app/api/settings.py` focus-universe save:
  - persist the resolved sync range into the observation pool.

## Frontend Changes

- Extend `FocusUniverseConfig` and `FocusUniversePreview` types.
- Update `FocusUniversePanel`:
  - label watchlist source as observation pool.
  - show watchlist group mode segmented control.
  - show group checklist with counts when mode is selected.
  - keep existing manual include/exclude behavior.
- Update `Watchlist` page:
  - show a compact group panel.
  - create/delete custom groups.
  - assign one symbol to custom groups.
  - display automatic source/exchange/industry/concept groups.

## Compatibility

- If `watchlist_groups.json` is absent or malformed, fallback to no custom groups and all watchlist symbols.
- Existing watchlist API responses remain valid.
- Selected group ids that no longer exist are ignored.
- If selected mode has no valid groups, watchlist source contributes no symbols; other sources still work.

## Validation

Targeted backend tests:

- existing watchlist resolves all symbols without group file.
- custom group selection filters watchlist symbols.
- auto exchange group selection filters symbols.
- saving focus universe writes the resolved range into watchlist.
- auto industry/concept groups are derived when local metadata exists.
- focus universe detail returns group preview and counts.

Frontend validation:

- `pnpm exec tsc -b`.
