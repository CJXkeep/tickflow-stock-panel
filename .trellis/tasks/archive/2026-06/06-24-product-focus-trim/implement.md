# 系统减脂与产品主线收敛 - Implementation Plan

## Preconditions

- User reviews and approves `prd.md` and `design.md`.
- Run `task.py start` before implementation.

## Implementation Checklist

1. Update navigation defaults in `frontend/src/components/Layout.tsx`.
   - Rename labels to `复盘` / `观察池` / `监控`.
   - Separate primary and secondary nav entries.
   - Show primary entries by default when no custom nav preferences exist.
   - Preserve user saved preferences when present.
   - Keep monitor unread badge behavior.

2. Update menu settings in `frontend/src/pages/settings/MenuSettings.tsx`.
   - Rename builtin labels.
   - Include all downgraded pages so users can restore them.
   - Add copy explaining focused default navigation.
   - Optionally mark auxiliary pages as `辅助` or `上下文`.

3. Update Dashboard shell in `frontend/src/pages/Dashboard.tsx`.
   - Rename title from `市场看板` to `复盘工作台`.
   - Adjust loading/error text to use review wording where appropriate.
   - Add concise review-oriented copy without changing data contracts.
   - Avoid large visual redesign in Phase 1.

4. Verify routes remain intact.
   - Ensure downgraded routes still exist in `router.tsx`.
   - Do not remove imports unless a page is truly unused.

5. Validation.
   - Run frontend build if available: `pnpm build`.
   - If build cannot run, run TypeScript check via existing build script or report blocker.
   - Manually inspect `git diff` for accidental backend/data changes.

## Risk Points

- `nav_hidden` semantics may conflict with new default hidden pages. The implementation must distinguish “no user preference yet” from “user intentionally configured nav”.
- Dynamic analysis menus should not silently disappear forever; they should remain recoverable via settings.
- Dashboard copy changes should not remove existing no-data and no-key guidance.

## Acceptance Review

Before reporting completion:

- Confirm sidebar default entries match PRD.
- Confirm Menu Settings lists hidden/auxiliary pages.
- Confirm direct routes still work by code inspection.
- Confirm build/type-check result.
