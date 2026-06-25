# 系统减脂与产品主线收敛

## Goal

将现有“大而全股票面板”收敛为“盘后复盘、观察池、策略跟踪、计划提醒”的主线体验。第一阶段先做低风险减脂:调整默认导航和页面命名/入口,保留旧页面能力,不做破坏性删除。

用户价值:

- 用户第一眼看到的是复盘和交易研究工作流,不是通用行情终端。
- 行业、概念、指数、财务等通用页面从主导航降级,减少噪音。
- 旧能力仍保留,可以通过路由、设置或上下文入口进入。

## Requirements

### Confirmed Facts

- `docs/product-focus-plan.md` 已确认产品方向:盘后复盘、策略生命周期、明日观察池、策略语义监控、AI 复盘助手。
- 当前左侧主导航位于 `frontend/src/components/Layout.tsx`,包含看板、自选、策略、回测、连板梯队、概念分析、行业分析、个股分析、财务、指数、交易、监控中心、数据等同级入口。
- 路由位于 `frontend/src/router.tsx`;旧页面可保留路由,不必删除。
- 菜单偏好已有后端/前端支持:`nav_order`、`nav_hidden`、`SettingsMenuSettingsPanel`。
- 因为已有菜单设置能力,第一阶段可以通过默认导航和文案收敛主线,保留用户手动恢复入口的能力。

### Phase 1 Scope

- 默认第一层导航收敛为:复盘、观察池、策略、回测、监控、数据。
- 设置保持底部固定入口,不进入主导航数组。
- 将 `看板` 命名为 `复盘`,仍使用 `/` 路由。
- 将 `自选` 命名为 `观察池`,仍使用 `/watchlist` 路由。
- 将 `监控中心` 命名为 `监控`,仍使用 `/monitor` 路由。
- 旧页面保留路由但默认不出现在主导航:连板梯队、概念分析、行业分析、个股分析、财务、指数、交易、扩展分析菜单。
- 菜单设置页应反映新的主线命名和默认分组,避免用户看到旧的“看板/自选”表达。
- Dashboard 页面第一阶段只做“复盘工作台壳子”与文案减脂,复用现有数据接口和模块,不新增后端数据模型。

### Out Of Scope

- 不删除旧页面代码。
- 不删除旧路由。
- 不新增观察池后端数据模型。
- 不实现完整 AI 复盘。
- 不实现策略生命周期持久化。
- 不重构监控规则后端。
- 不做大规模视觉重设计。

## Acceptance Criteria

- [x] 默认侧边栏只展示主线入口:复盘、观察池、策略、回测、监控、数据、设置。
- [x] 原通用行情/分析页面仍可通过直接路由访问,不出现 404。
- [x] 菜单设置页可以看到被降级的页面,用户能手动恢复显示。
- [x] `看板` 在主体验中改为 `复盘`;`自选` 改为 `观察池`;`监控中心` 改为 `监控`。
- [x] Dashboard 首屏文案表达“复盘工作台/盘后研究”而不是“市场看板”。
- [x] 无本地数据、无 Key、数据刷新等现有提示仍可用。
- [x] 前端构建或至少 TypeScript 检查通过。

## Notes

- This is a complex frontend product-structure task; add `design.md` and `implement.md` before implementation.
- Do not start implementation until the user approves the planning artifacts.
- Validation: `pnpm exec tsc -b` passed. Full `pnpm build` and `pnpm dev` reached Vite config loading but were blocked by sandbox `esbuild spawn EPERM`; `pnpm lint` is unavailable because `eslint` is not installed in the frontend package.

## Open Questions

- Resolved: first implementation uses A scope only: change default navigation, product naming, and Dashboard review-workbench shell copy. Do not reshape Dashboard data modules or add new data models in this task.
