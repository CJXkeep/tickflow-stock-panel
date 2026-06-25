# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Quality checks should match the blast radius of the change. For frontend
information-architecture or product-language work, verify both code correctness
and user-visible consistency.

---

## Forbidden Patterns

- Do not delete routes or page imports to reduce navigation clutter unless the
  task explicitly asks for capability removal.
- Do not overwrite saved preferences merely to introduce new defaults.
- Do not duplicate route labels in multiple places without checking all primary
  UI surfaces for product-language consistency.
- Do not rely on README or hidden dev-page text as acceptance proof for the main
  product experience.

---

## Required Patterns

- For navigation changes, inspect `Layout.tsx`, `router.tsx`, and menu settings
  together.
- Preserve direct route access for downgraded/context pages.
- Run `rg` for old product names after user-visible label changes.
- Record validation results in the active Trellis task when the task has one.

---

## Testing Requirements

Minimum frontend verification:

- `pnpm exec tsc -b`
- `git diff --check`

Preferred verification:

- `pnpm build`
- local Vite preview or dev server inspection when the environment allows
  esbuild/Vite child processes

If Vite is blocked by the sandbox with `esbuild spawn EPERM`, record that
blocker and keep the TypeScript check result.

---

## Code Review Checklist

- [ ] Changed lines trace to the task scope.
- [ ] Product labels are consistent across sidebar, page headers, empty states,
      buttons, and settings panels.
- [ ] Route compatibility is preserved.
- [ ] Preference semantics are backward compatible.
- [ ] TypeScript validation result is recorded.
