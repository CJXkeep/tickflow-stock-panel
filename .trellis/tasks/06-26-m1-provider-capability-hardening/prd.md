# M1 Provider 与能力边界硬化

## Goal

按照 `docs/开发路书.md` 的 M1 要求,把 TickFlow、AkShare 和未来 provider 的能力边界收口到标准 capability/limits 合约中。前端和业务服务不再用 `tier_label` / `tierRank()` 这类展示型档位字符串决定真实功能可用性。

用户价值:

- `DATA_PROVIDER=akshare` 时不会误触发 TickFlow 专属探测、网络路径或实时/分钟/五档能力。
- TickFlow none/free/starter+/pro/expert 的能力差异仍能通过 capability limits 表达。
- 数据页、pipeline 和设置/监控 UI 对“当前 provider 支持什么、不支持什么”使用同一套语义。

## Confirmed Facts

- `docs/数据源与能力门控契约.md` 已要求后端统一暴露 `GET /api/capabilities` 的 `provider/label/capabilities`。
- `backend/app/tickflow/capabilities.py` 当前 `CapabilityLimits` 只有 `rpm/batch/subscribe`。
- `frontend/src/lib/api.ts` 当前 `CapabilityLimits` 类型也只有 `rpm/batch/subscribe`,但设置偏好返回体已经有 `realtime_allowed` 字段。
- `backend/app/tickflow/policy.py` 在 AkShare 模式下返回静态日线能力,不应触发 TickFlow 探测。
- `backend/app/api/kline.py` 的 `extend_minute_history` 仍用 `tier_label()` 判断 month 单位是否允许。
- `backend/app/services/depth_service.py` 的 `_compute_interval()` 仍用 `tier_label()` 决定五档轮询间隔范围。
- `backend/app/services/quote_service.py` 仍用 `tier_label()` 判断实时行情允许状态和最小轮询间隔。
- `frontend/src/lib/capability-labels.tsx` 的 `tierRank()` 仍被 `Layout`、`settings/Monitoring`、`EndpointTestDialog`、`DepthConfigCard` 等真实门控消费。
- `frontend/src/components/data/DepthConfigCard.tsx` 用档位 label 推导轮询范围文案和 input min/max。
- 既有任务 `.trellis/tasks/06-24-akshare-free-data-source` 已完成 AkShare provider 模式的产品范围定义;本任务是后续 hardening,不是新增 provider。

## Requirements

### Capability Limits Contract

- 扩展 `CapabilityLimits` 以表达:
  - `rpm`
  - `batch`
  - `subscribe`
  - `min_interval`
  - `max_interval`
  - `max_history_days`
  - `realtime_allowed`
- 缺失字段必须保持向后兼容,序列化为 `null` 或省略时前端能安全处理。
- TickFlow limits 优先来自 `tiers.yaml` / 探测覆盖后的 capability set。
- AkShare 静态能力只暴露日线能力,不得携带实时、分钟 K、五档、财务等增强 capability。

### Backend Gating

- 分钟 K 扩展历史的长历史门控必须改成 capability limit,不再读取 `tier_label()`。
- 五档轮询间隔范围必须来自 `depth5.batch` capability limits,不再读取 `tier_label()`。
- 实时行情允许状态和最小/最大轮询间隔必须来自 `quote.batch` 或等价 realtime capability limits,不再读取 `tier_label()`。
- 不满足能力时返回明确 403 或受控禁用状态。

### Frontend Gating

- 前端真实功能门控必须消费 `/api/capabilities` 返回的 capability/limits。
- `tierRank()` / `isExpertOrAbove()` 只能保留为展示或兼容辅助,不能继续作为真实功能启停判断。
- 五档配置卡展示服务端契约的轮询范围,不在组件内从档位 label 推导。
- AkShare 模式下实时、分钟 K、五档、财务入口必须灰显或由后端返回 403,且不出现 TickFlow 档位推断。

### Provider Stage Matrix

- 建立一份 provider stage matrix 的代码侧来源,供数据页和 pipeline 共享或至少从同一模块导出。
- matrix 至少覆盖:
  - capability detection
  - startup auto network sync
  - manual after-market pipeline
  - focus scope sync
  - market sync
  - realtime quotes
  - minute K
  - depth5
  - financial
  - adj factor
  - index daily K
- AkShare 不支持的阶段必须明确为 unsupported/disabled/manual-only,不能依赖 TickFlow 档位文案兜底。

### Compatibility

- 默认 TickFlow 模式行为不退化。
- 已存在的 capability cache 读取要考虑 schema 版本升级。
- 前端类型更新后,旧后端或旧缓存返回缺失字段时不应崩溃。

## Acceptance Criteria

- [ ] `CapabilityLimits` 后端模型和前端类型支持 `rpm/batch/subscribe/min_interval/max_interval/max_history_days/realtime_allowed`。
- [ ] `tiers.yaml` 或 provider capability 构造能表达 TickFlow 实时轮询间隔、五档轮询间隔和分钟 K 最大历史天数。
- [ ] `DATA_PROVIDER=akshare` 时 `/api/capabilities` 只返回 AkShare 日线 capability,且不触发 TickFlow 探测或 TickFlow 专属网络路径。
- [ ] `backend/app/api/kline.py` 的 `extend_minute_history` 不再通过 `tier_label()` 判断 Expert/month 权限。
- [ ] `backend/app/services/depth_service.py` 的轮询间隔范围不再通过 `tier_label()` 判断。
- [ ] `backend/app/services/quote_service.py` 的实时允许状态和最小轮询间隔不再通过 `tier_label()` 判断。
- [ ] `frontend/src/lib/capability-labels.tsx` 中的 `tierRank()` 不再被真实功能门控依赖;如保留,只能用于展示/样式。
- [ ] `frontend/src/components/data/DepthConfigCard.tsx` 的范围文案和输入 clamp 来自 capability limits。
- [ ] 数据页和 pipeline 对 provider stage 的描述来自同一份 matrix 或共享契约。
- [ ] AkShare 模式下实时、分钟 K、五档、财务相关入口灰显或 403,不会误显示 TickFlow 专属能力。
- [ ] 免费数据源模式仍能完成关注范围日线同步、指标、选股、K 线和基础回测。
- [ ] TickFlow 模式下 none/free/starter+/pro/expert 现有能力边界不退化。
- [ ] 前端 TypeScript 检查通过。
- [ ] 后端至少通过针对 capability/limits 的单元测试或静态检查。

## Out Of Scope

- 新增新的 provider。
- 重写 TickFlow SDK client 或 AkShare sync service。
- 完整 M6 系统级验收矩阵。
- 改造观察池、复盘、总计划或写入事件 registry。
- 改变本地 Parquet 表结构。

## Open Questions

- 推荐范围:把 `QuoteService` 和 `Layout`/`settings/Monitoring` 中发现的实时行情门控一并纳入 M1 最小闭环。若只按路书点名文件处理,`min_interval/max_interval/realtime_allowed` 会缺少实际消费者,AkShare 模式仍可能留有实时开关的档位推断。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
