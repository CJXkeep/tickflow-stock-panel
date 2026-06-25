# Component Guidelines

> How components are built in this project.

---

## Overview

Frontend components are React function components using TypeScript and
Tailwind utility classes. Shared surfaces live under `frontend/src/components`,
while route-level pages live under `frontend/src/pages`.

Prefer small page-local helper components for tightly scoped display logic, and
shared components only when multiple pages genuinely reuse the same behavior.
Examples of shared surfaces include `PageHeader`, `EmptyState`, stock table
components, chart wrappers, and settings/data cards.

---

## Component Structure

- Keep route-level pages as exported functions from `frontend/src/pages`.
- Keep reusable UI primitives under `frontend/src/components`.
- Keep page-specific helper components in the page file when they are not reused.
- Use `lucide-react` icons for visible controls and page section affordances.
- Avoid broad visual rewrites when the task is an information-architecture or
  naming change.

---

## Props Conventions

- Define local prop shapes inline for small page-local components.
- Export prop types only when external callers need them.
- Prefer explicit discriminating fields for UI grouping, such as
  `group: 'primary' | 'context'`, over inferring behavior from label text.
- Preserve existing callback names when the underlying API or storage still
  uses legacy domain names; change user-visible labels separately.

---

## Styling Patterns

Styling is Tailwind-first with project tokens such as `bg-base`, `bg-surface`,
`text-foreground`, `text-muted`, `border-border`, `rounded-card`, and
`rounded-btn`.

Operational pages should stay dense and work-focused. Use restrained copy and
small supporting subtitles rather than large marketing blocks.

---

## Accessibility

Icon-only buttons should have `title` text that names the action. Navigation
links should keep concise labels that fit the sidebar width.

---

## Common Mistakes

- Renaming the sidebar label but leaving page headers, empty states, tooltips,
  or onboarding copy on the old product language.
- Hiding a page from the sidebar by deleting routes or imports. Product trimming
  should hide entry points first and preserve compatibility.
