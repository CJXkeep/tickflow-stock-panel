# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains active frontend conventions for the TickFlow Stock Panel
React application. These files describe current project practice, not generic
frontend ideals.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Active |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | Active |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | Active |
| [State Management](./state-management.md) | Local state, global state, server state | Active |
| [Product Navigation](./product-navigation.md) | Sidebar IA, product naming, route compatibility | Active |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Active |
| [Type Safety](./type-safety.md) | Type patterns, validation | Active |

---

## How to Use These Guidelines

Before changing frontend code, read the guide that matches the layer you are
touching. For navigation, sidebar, route naming, or product-language work,
always read `product-navigation.md` in addition to the component/state guides.

When a task reveals a new convention or a repeated pitfall, update the relevant
guide in the same change set.

---

**Language**: All documentation should be written in **English**.
