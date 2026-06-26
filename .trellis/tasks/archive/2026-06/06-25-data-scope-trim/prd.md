# 数据减脂与按需同步

## Goal

把项目的数据获取策略从“默认全市场、全指标、全数据”收敛为“默认只维护关注范围和关键指标,全市场和重数据手动触发”。目标是让日常复盘/观察池/策略跟踪更快、更干净,避免用户每次同步都被大量无关数据拖慢。

## Requirements

### Confirmed Direction

- 当前默认同步和数据页仍偏“本地行情库/数据工程控制台”。
- 用户不需要每次拉全 A 股、分钟 K、财务、指数完整历史和大量指标。
- 默认应该只同步“需要关注的股票”和少量关键指标。
- 其他数据可以保留能力,但必须降级为手动触发或高级任务。
- 指标展示要默认收窄,后续可通过列配置/高级字段再调出来。

### Phase 1 Scope

- 新增核心关注范围解析逻辑,默认由观察池、策略监控/跟踪池、最近监控触发、少量兜底标的组成。
- TickFlow 盘后管道默认同步核心关注范围,不再默认优先拉 `CN_Equity_A` 全市场。
- AkShare 默认日 K 同步只同步核心关注范围;全市场 AkShare 同步保留为手动/高级模式。
- 数据页文案从“全市场/全量管道”改为“关注范围/按需同步”,把全市场、分钟 K、财务、指数等重任务标为手动或高级。
- 股票列表默认指标列收窄到决策常用指标,把 MACD/KDJ/BOLL/ATR/多周期动量等高噪声列默认隐藏,但保留可选列定义。

### Out Of Scope

- 不删除已有全市场同步能力。
- 不删除已有指标计算字段。
- 不重构完整观察池数据模型。
- 不实现策略生命周期数据库。
- 不重做全套数据页视觉设计。
- 不改变历史 parquet 存储格式。

## Acceptance Criteria

- [x] 默认盘后同步不再主动优先解析全 A 股池。
- [x] 默认 AkShare 日 K 同步不再遍历全部 instruments。
- [x] 全市场同步仍可通过显式参数或高级手动入口保留。
- [x] 数据页文案清楚表达默认是关注范围同步,重任务需要手动触发。
- [x] 观察池/策略页默认表格指标列明显减少,高噪声指标可在列配置中恢复。
- [x] 前端 TypeScript 检查通过。
- [x] 后端相关变更有基本静态/语法检查或明确说明未验证原因。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
