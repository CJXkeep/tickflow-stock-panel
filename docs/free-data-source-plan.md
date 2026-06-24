# 免费数据源替换方案

本文档用于规划在不依赖 TickFlow 的情况下,使用免费数据源运行本项目的改造路线。目标用户是个人研究、盘后分析、低频选股和策略回测场景,不追求高实时性。

## 1. 目标

在保留现有前端页面、策略引擎、指标流水线、回测和监控能力的前提下,新增免费数据源适配层:

- 保留 TickFlow 原有功能
- 新增 `DATA_PROVIDER=akshare` 免费数据源模式
- 不做破坏式替换,通过配置在 TickFlow / AkShare 之间切换
- 主数据源: AkShare
- 备用数据源: BaoStock
- 本地存储: 沿用现有 DuckDB / Parquet 数据结构
- 更新频率: 以每日收盘后同步为主
- 实时能力: 暂不作为第一阶段目标

第一阶段先让核心功能跑起来:

- 股票基础列表
- 最近 3 年 A 股前复权日 K
- 指数日 K
- 行业字段
- 技术指标计算
- 策略选股
- 基础回测
- 自选股与个股 K 线查看

第一阶段暂不做:

- 实时行情
- 分钟 K
- 五档盘口
- 财务数据
- 概念数据
- 涨停池 / 真假封单
- 启动时自动同步

## 1.1 已确认决策

以下决策来自改造前的方案拷问,作为 Phase 1 的边界:

| 决策项 | 结论 |
| :--- | :--- |
| 原 TickFlow 功能 | 保留,不删除 |
| 数据源切换 | 新增 `DATA_PROVIDER`,支持 `tickflow` / `akshare` |
| AkShare 模式能力 | TickFlow 专属功能灰显,提示当前数据源不支持 |
| 内部股票代码 | 统一使用 `000001.SZ` / `600000.SH` / `8xxxxx.BJ` |
| 复权方案 | 第一阶段直接使用 AkShare 前复权日 K,暂不维护复权因子 |
| 初始历史长度 | 默认最近 3 年 |
| 财务数据 | 第一阶段不做,财务页灰显 |
| 行业 / 概念 | 第一阶段只做行业,不做概念 |
| 同步触发 | 启动时不自动联网,只在数据页手动触发 |
| 同步失败 | 保留旧数据,记录失败批次,不清空旧数据 |
| 品牌 | 第一阶段不改品牌,只显示当前数据源 |
| CapabilitySet | 继续复用,语义扩展为"当前数据源能力" |

## 2. 数据源选择

### 2.1 AkShare

AkShare 适合作为首选免费数据源,原因是覆盖面广,接口以 Python 为主,和当前后端技术栈匹配。

可覆盖的数据类型:

- A 股股票列表
- 日线行情
- 复权行情
- 指数行情
- 行业板块
- 概念板块
- 财务数据
- 涨停池、强势股、市场情绪类数据

主要优点:

- 免费
- 覆盖面广
- 适合个人本地研究
- 可以补齐概念、行业、涨停等特色页面所需数据

主要风险:

- 部分接口依赖公开网页,稳定性可能变化
- 字段名和返回结构可能随上游变动
- 不适合对实时性、稳定性要求很高的生产系统

### 2.2 BaoStock

BaoStock 适合作为备用或补充数据源。

可覆盖的数据类型:

- A 股日线
- 复权数据
- 指数数据
- 部分财务数据

主要优点:

- 免费
- 日线数据相对直接
- 适合基础回测

主要限制:

- 板块、概念、涨停生态数据较弱
- 分钟线和实时能力不适合作为重点
- 覆盖面不如 AkShare

## 3. 推荐策略

推荐先采用以下组合:

```text
DATA_PROVIDER=akshare
FALLBACK_PROVIDER=baostock
SYNC_MODE=daily
AKSHARE_INITIAL_YEARS=3
```

使用方式:

- 每天收盘后拉取日线数据
- 本地保存为 Parquet
- 用现有指标流水线生成 enriched 数据
- 策略、回测、看板统一读取本地数据
- BaoStock 仅在 AkShare 某些基础行情接口不可用时补充
- 默认由用户在数据页手动触发同步,不在应用启动时自动联网

不建议一开始追求完整替换所有 TickFlow 能力。更稳妥的方式是先完成日线级最小闭环,再逐步补齐概念、行业、财务和涨停数据。

## 4. 最小字段规范

为了复用当前策略、指标、回测和前端表格,建议将不同数据源统一映射到以下字段。

### 4.1 股票基础信息

```text
symbol          股票代码,如 000001.SZ 或 600000.SH
code            原始代码,如 000001
name            股票名称
exchange        交易所,如 SZSE / SSE / BSE
market          市场分类
list_date       上市日期
is_st           是否 ST
```

### 4.2 日 K 行情

```text
symbol          股票代码
trade_date      交易日期
open            开盘价
high            最高价
low             最低价
close           收盘价
pre_close       昨收价
volume          成交量
amount          成交额
pct_change      涨跌幅
change          涨跌额
turnover_rate   换手率
adjust          复权类型
```

### 4.3 指数行情

```text
symbol
name
trade_date
open
high
low
close
pre_close
volume
amount
pct_change
```

### 4.4 板块与概念

```text
symbol
name
dimension_type   industry / concept
dimension_code
dimension_name
source
updated_at
```

### 4.5 财务数据

财务数据可放到第二或第三阶段。初期只需要保证页面可灰显或提示未同步。

```text
symbol
report_date
period_type
revenue
net_profit
total_assets
total_liabilities
operating_cashflow
roe
gross_margin
```

## 5. 架构改造建议

不要在现有业务代码里到处替换 TickFlow 调用。建议新增统一数据源层,让业务服务只依赖统一接口。

建议目录:

```text
backend/app/datasource/
  __init__.py
  base.py
  registry.py
  akshare_source.py
  baostock_source.py
  tickflow_source.py
```

### 5.1 基础接口

```python
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import date

import polars as pl


class MarketDataSource(ABC):
    @abstractmethod
    def list_stocks(self) -> pl.DataFrame:
        """返回股票基础信息。"""

    @abstractmethod
    def daily_bars(self, symbols: list[str], start: date, end: date, adjust: str = "qfq") -> pl.DataFrame:
        """返回日 K 行情。"""

    @abstractmethod
    def index_bars(self, symbols: list[str], start: date, end: date) -> pl.DataFrame:
        """返回指数日 K。"""

    def industries(self) -> pl.DataFrame | None:
        return None

    def concepts(self) -> pl.DataFrame | None:
        return None

    def financials(self, symbols: list[str]) -> pl.DataFrame | None:
        return None
```

### 5.2 配置项

`.env` 建议新增:

```text
DATA_PROVIDER=akshare
FALLBACK_PROVIDER=baostock
DATA_SYNC_MODE=daily
AKSHARE_INITIAL_YEARS=3
AKSHARE_TIMEOUT_SECONDS=20
AKSHARE_RETRY_COUNT=3
```

保留 TickFlow 相关配置,便于后续在不同数据源之间切换。

## 6. 分阶段路线

### Phase 1: 日线最小闭环

目标: 不依赖 TickFlow,完成基础日线数据同步与策略运行。

改造内容:

- 新增 `datasource` 基础接口
- 新增 `AkShareDataSource`
- 新增 AkShare 静态 CapabilitySet
- 同步股票列表
- 同步最近 3 年 A 股前复权日 K
- 同步指数日 K
- 同步行业字段
- 写入现有 data 目录
- 跑通 enriched 指标计算
- 跑通 Screener 页面
- 跑通个股 K 线页面
- 跑通基础回测
- 数据页显示当前数据源
- TickFlow 专属能力在 AkShare 模式下灰显

验收标准:

- 能选择日期运行选股
- 能打开个股详情并看到日 K
- 能执行至少一个内置策略
- 能对一个策略或单只股票做基础回测
- 同步失败时旧数据仍可继续使用

### Phase 2: 指数、行业、概念

目标: 在 Phase 1 的指数和行业基础上,继续恢复概念分析体验。

改造内容:

- 同步概念板块
- 建立股票与概念映射
- 修复前端页面中依赖 TickFlow 字段的展示

验收标准:

- Dashboard 能显示主要指数
- Concept Analysis 有可用数据
- 股票详情能显示所属行业和概念

### Phase 3: 涨停、连板、市场情绪

目标: 尽量恢复短线题材分析相关页面。

改造内容:

- 接入 AkShare 涨停池数据
- 接入炸板、连板、强势股等数据
- 统一涨停状态字段
- 校准连板数计算逻辑

验收标准:

- LimitUpLadder 页面可用
- 涨停相关策略可运行
- 监控规则可基于涨停字段触发

### Phase 4: 财务与扩展数据

目标: 补齐中长期分析能力。

改造内容:

- 同步利润表
- 同步资产负债表
- 同步现金流量表
- 标准化报告期字段
- 将财务字段接入 Screener 和个股分析

验收标准:

- Financials 页面可用
- 个股财务摘要可展示
- 策略可引用部分财务字段

## 7. 需要重点改动的模块

当前项目中和 TickFlow 相关度较高的目录:

```text
backend/app/tickflow/
backend/app/services/kline_sync.py
backend/app/services/index_sync.py
backend/app/services/financial_sync.py
backend/app/services/instrument_sync.py
backend/app/services/quote_service.py
backend/app/api/data.py
backend/app/api/kline.py
backend/app/api/indices.py
backend/app/api/financials.py
backend/app/api/overview.py
tiers.yaml
```

推荐处理方式:

- `backend/app/tickflow/` 暂时保留
- 新增 `backend/app/datasource/`
- 同步服务逐步改为依赖 `MarketDataSource`
- 前端页面尽量不关心真实数据源
- TickFlow 能力档位逻辑改成通用 capability 标识

## 8. 数据质量与容错

免费数据源必须做好容错,否则日常使用会很容易被上游接口波动影响。

建议策略:

- 每个接口加超时
- 每个接口加重试
- 同步任务按 symbol 分批
- 每批写入前做字段校验
- 同步失败只标记失败批次,不要清空旧数据
- 保留最近一次成功同步的数据
- 在前端显示数据更新时间
- 对缺失字段做灰显或提示,不要让页面崩溃

建议记录同步状态:

```text
data/sync_state.json
```

示例:

```json
{
  "provider": "akshare",
  "last_daily_sync": "2026-06-24",
  "last_successful_trade_date": "2026-06-23",
  "failed_symbols": ["000001.SZ"],
  "updated_at": "2026-06-24T16:10:00+08:00"
}
```

## 9. 不作为首期目标

以下能力不建议放在第一阶段:

- 秒级实时行情
- 五档盘口
- 逐笔成交
- 盘中高频监控
- 自动交易下单
- 完整替换所有财务字段
- 多数据源自动融合纠错

第一阶段只做盘后日线闭环,更容易稳定落地。

## 10. 推荐实施顺序

```text
1. 新增 DATA_PROVIDER 配置
2. 新增 datasource 基础接口
3. 实现 AkShare 股票列表同步
4. 实现 AkShare 日 K 同步
5. 写入现有 Parquet 数据目录
6. 跑通指标流水线
7. 跑通 Screener
8. 跑通 K 线和回测
9. 增加指数同步
10. 增加行业、概念、涨停数据
```

完成前 8 步后,项目就可以作为免费的盘后选股和回测工作台使用。
