# 观察池同步范围与分组

## Goal

把“关注范围同步”里的 `watchlist` 来源明确升级为“观察池范围”,并支持观察池自动分组与用户自定义分组。同步范围不再只是一个扁平股票列表,而是可以从观察池的全部标的或指定分组中解析。

用户价值:

- 用户加入观察池的标的默认就是盘后/关注范围同步的核心范围。
- 系统能根据来源、行业/概念等信息自动生成分组,降低维护成本。
- 用户可以自定义分组,例如“核心观察”“短线验证”“低吸池”“财报跟踪”。
- 数据页同步范围可以只同步某些观察池分组,避免范围越来越大后浪费时间。

## Requirements

- 保留现有 `watchlist.parquet` 兼容行为,旧观察池标的不能丢。
- 新增观察池分组元数据,建议存放在 `data/user_data/watchlist_groups.json`。
- 每个观察池标的可属于 0 个或多个自定义分组。
- 系统应提供自动分组结果,但自动分组不应覆盖用户自定义分组。
- 第一版自动分组至少支持:
  - 按来源: 手动添加、策略命中、监控规则、最近告警。
  - 按交易所: SH / SZ / BJ。
  - 如本地维表或扩展数据有行业/板块/概念字段,可输出行业或概念分组;没有则跳过。
- 关注范围配置应支持:
  - 是否启用观察池来源。
  - 观察池同步模式: 全部观察池 / 指定分组。
  - 指定分组 id 列表。
- `resolve_focus_universe_detail()` 返回分组维度的预览,包括每个分组的 symbol 列表和数量。
- 数据页 `FocusUniversePanel` 能展示观察池分组,允许选择同步全部或部分分组。
- 自定义分组第一版在观察池页面维护,并支持创建、删除和给单只股票勾选所属自定义组。

## API Expectations

- `GET /api/watchlist/groups`
- `POST /api/watchlist/groups`
- `PUT /api/watchlist/groups/{id}`
- `DELETE /api/watchlist/groups/{id}`
- `PUT /api/watchlist/{symbol}/groups`
- `GET /api/watchlist/group-preview`
- 现有 `/api/settings/preferences/focus-universe` 扩展返回和保存:
  - `watchlist_group_mode: "all" | "selected"`
  - `watchlist_group_ids: string[]`

## Acceptance Criteria

- [ ] 旧 `watchlist.parquet` 数据在没有分组文件时仍能作为“全部观察池”同步。
- [ ] 可以创建、删除自定义观察池分组。
- [ ] 可以把某只观察池标的加入或移出自定义分组。
- [ ] 自动分组能返回来源分组、交易所分组、行业/概念分组。
- [ ] 关注范围配置选择“全部观察池”时行为与当前 watchlist 来源一致。
- [ ] 关注范围配置选择“指定分组”时只同步这些组内标的。
- [ ] 保存同步范围会把最终范围写入观察池。
- [ ] `FocusUniversePanel` 能展示观察池分组预览和组内数量。
- [ ] 保存同步范围后,AkShare/TickFlow 的关注范围同步都使用同一套分组解析结果。
- [ ] 后端 targeted tests 覆盖旧数据兼容、分组筛选、范围写入观察池和自动分组。

## Out Of Scope

- 完整 M3 观察池领域对象,例如 thesis、trigger_price、invalid_price、review_notes。
- 策略命中一键加入观察池的完整流程。
- 观察项状态流转和复盘闭环。
- 复杂拖拽分组排序。

## Notes

- 这个任务是 M3 观察池领域模型前置切片,但优先服务数据同步范围。
- 分组是观察池上的元数据,不是行情或 provider capability。
