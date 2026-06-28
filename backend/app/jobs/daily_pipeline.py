"""盘后管道 + 盘前维表同步。

调度:
  09:10 盘前 — 同步标的维表 instruments (全量覆盖)
  15:30 盘后 — 日K同步 + 增量除权因子 + enriched 计算 + 刷新视图

盘后同步策略:
  日 K: QuoteService 交易时段已实时落盘 → 有数据时跳过 batch,首次拉 1 年区间
  除权因子: 从已有数据最新日期的下一天开始增量获取,避免重复拉取和计算
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Literal

import polars as pl
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.indicators.pipeline import run_pipeline
from app.config import settings
from app.services import focus_universe, index_sync, instrument_sync, kline_sync, preferences
from app.tickflow.capabilities import Cap, CapabilitySet
from app.tickflow.pools import DEMO_SYMBOLS, get_pool
from app.tickflow.repository import KlineRepository

logger = logging.getLogger(__name__)

ProgressCb = Callable[..., None]

_SCHEDULER_JOB_IDS = (
    "pre_market_instruments",
    "daily_pipeline",
    "depth_finalize",
)
UniverseScope = Literal["focus", "market"]
FOCUS_HISTORY_BACKFILL_DAYS = 365
FOCUS_HISTORY_MIN_ROWS = 60


def _noop(stage: str, pct: int, msg: str, **kwargs) -> None:  # noqa: ARG001
    pass


def _invalidate(table: str | None = None) -> None:
    """stage 写完调用,让 /api/data/status 只重算被影响的那张表。"""
    from app.api.data import invalidate_data_cache
    invalidate_data_cache(table)


def _resolve_market_universe(capset: CapabilitySet) -> list[str]:
    """Resolve the explicit full-market universe."""
    if capset.has(Cap.KLINE_DAILY_BATCH):
        try:
            all_a = get_pool("CN_Equity_A", refresh=True)
            if all_a:
                return sorted(all_a)
        except Exception as e:  # noqa: BLE001
            logger.warning("CN_Equity_A pool unavailable, fallback: %s", e)

    base: set[str] = set(DEMO_SYMBOLS)
    base.update(get_pool("watchlist"))
    d = Path(settings.data_dir)
    inst_path = d / "instruments" / "instruments.parquet"
    if inst_path.exists():
        try:
            inst = pl.read_parquet(inst_path, columns=["symbol"])
            base.update(inst["symbol"].to_list())
        except Exception as e:  # noqa: BLE001
            logger.warning("instruments supplement failed: %s", e)
    return sorted(base)


def _resolve_universe(capset: CapabilitySet, scope: UniverseScope = "focus") -> list[str]:
    """Resolve the sync universe.

    focus is the daily default and only reads local attention signals.
    market keeps the old all-market behavior for explicit manual jobs.
    """
    if scope == "market":
        return _resolve_market_universe(capset)
    return focus_universe.resolve_focus_universe(settings.data_dir)


def _symbols_needing_focus_history(repo: KlineRepository, symbols: list[str]) -> list[str]:
    """Return focus symbols whose local daily history is too short for pct/indicators."""
    if not symbols:
        return []
    data_glob = str(repo.store.data_dir / "kline_daily" / "**" / "*.parquet")
    symbol_set = set(symbols)
    try:
        stats = (
            pl.scan_parquet(data_glob)
            .filter(pl.col("symbol").is_in(symbols))
            .group_by("symbol")
            .agg(pl.len().alias("rows"))
            .collect()
        )
    except Exception as e:  # noqa: BLE001
        logger.debug("focus history coverage scan skipped: %s", e)
        return symbols

    counts = {
        str(row["symbol"]): int(row["rows"] or 0)
        for row in stats.to_dicts()
        if row.get("symbol")
    }
    return sorted(sym for sym in symbol_set if counts.get(sym, 0) < FOCUS_HISTORY_MIN_ROWS)


def run_instruments_sync(repo: KlineRepository) -> dict:
    """盘前同步标的维表。"""
    rows = instrument_sync.sync_instruments(repo.store.data_dir)
    _refresh_instruments_view(repo)
    _invalidate("instruments")
    return {"instruments_rows": rows}


def run_now(
    repo: KlineRepository,
    capset: CapabilitySet,
    on_progress: ProgressCb | None = None,
    full_market: bool = False,
) -> dict:
    """立即执行一次盘后管道,支持进度回调。

    跳过的 stage **不 emit**,避免前端把"无 capability"的卡片错误标记为 active/done。
    result 里带 skipped_stages 列表供前端展示。
    """
    if settings.provider_is_akshare:
        return _run_akshare_now(repo, capset, on_progress=on_progress, full_market=full_market)

    emit = on_progress or _noop
    skipped: list[str] = []
    scope: UniverseScope = "market" if full_market else "focus"
    scope_label = "全市场" if scope == "market" else "关注范围"

    # Step 0: 先同步标的维表, 再解析标的池 — 确保标的池基于最新 instruments
    emit("sync_instruments", 2, "同步标的维表…")
    inst_rows = instrument_sync.sync_instruments(repo.store.data_dir)
    if inst_rows > 0:
        _refresh_instruments_view(repo)
    emit("sync_instruments", 8, f"标的维表同步完成,{inst_rows} 只标的")
    _invalidate("instruments")

    emit("resolve_universe", 9, f"解析{scope_label}…")
    universe = _resolve_universe(capset, scope=scope)
    emit("resolve_universe", 10, f"{scope_label}规模:{len(universe)} 只")

    # Step 1: 日 K 同步
    #   今天有数据 → 实时行情接口拉一次覆写（focus 按 symbols, market 按全市场）
    #   今天没数据 → batch K-line API 补齐
    #   无任何数据 → batch K-line API 拉首次 1 年
    from datetime import date as _date, timedelta as _td, datetime as _dt
    latest_daily = repo.latest_daily_date()
    today = _date.today()
    today_exists = latest_daily and latest_daily >= today
    new_daily_days = 0

    if today_exists:
        # 今天有数据（QuoteService 已落盘）→ 实时行情覆写，确保最新
        emit("sync_daily", 12, f"获取日K [{today} ~ {today}] 实时行情…")
        written_daily = kline_sync.sync_daily_by_quotes(
            repo,
            symbols=None if scope == "market" else universe,
        )
        if scope == "focus" and written_daily == 0:
            written_daily = kline_sync.sync_and_persist_daily_batch(
                universe, repo, capset,
                start_date=_dt.combine(today, _dt.min.time()),
                end_date=_dt.combine(today, _dt.min.time()),
            )
        new_daily_days = 1
        emit("sync_daily", 45, f"日K 完成,{written_daily} 只标的")
        logger.info("sync_daily: [%s ~ %s] live quotes, %d symbols", today, today, written_daily)
    elif latest_daily:
        # 有历史但今天没数据 → batch 补齐缺口
        start_date = latest_daily
        emit("sync_daily", 12, f"获取日K [{start_date} ~ {today}]…")
        logger.info("sync_daily: [%s ~ %s] gap fill", start_date, today)

        def _daily_chunk_progress(cur: int, tot: int) -> None:
            emit("sync_daily", 12 + int(33 * cur / tot),
                 f"日K 批次 {cur}/{tot}", stage_pct=int(100 * cur / tot), skip_log=True)
        written_daily = kline_sync.sync_and_persist_daily_batch(
            universe, repo, capset,
            start_date=_dt.combine(start_date, _dt.min.time()),
            end_date=_dt.combine(today, _dt.min.time()),
            on_chunk_done=_daily_chunk_progress,
        )
        gap_days = (today - start_date).days
        new_daily_days = gap_days
        emit("sync_daily", 45, f"日K 完成,覆盖 {gap_days} 天")
        logger.info("sync_daily: [%s ~ %s] done, %d days", start_date, today, gap_days)
    else:
        # 首次：无任何数据 → batch 拉 1 年
        start_date = today - _td(days=365)
        emit("sync_daily", 12, f"获取日K [{start_date} ~ {today}]…")
        logger.info("sync_daily: [%s ~ %s] initial fetch", start_date, today)

        def _daily_chunk_progress(cur: int, tot: int) -> None:
            emit("sync_daily", 12 + int(33 * cur / tot),
                 f"日K 批次 {cur}/{tot}", stage_pct=int(100 * cur / tot), skip_log=True)
        written_daily = kline_sync.sync_and_persist_daily_batch(
            universe, repo, capset,
            start_date=_dt.combine(start_date, _dt.min.time()),
            end_date=_dt.combine(today, _dt.min.time()),
            on_chunk_done=_daily_chunk_progress,
        )
        new_daily_days = 365
        emit("sync_daily", 45, "日K 完成")
        logger.info("sync_daily: [%s ~ %s] done", start_date, today)

    if scope == "focus" and capset.has(Cap.KLINE_DAILY_BATCH):
        need_history = _symbols_needing_focus_history(repo, universe)
        if need_history:
            start_date = today - _td(days=FOCUS_HISTORY_BACKFILL_DAYS)
            emit(
                "sync_daily_history",
                46,
                f"补齐关注范围历史 ({len(need_history)} 只)…",
            )
            logger.info(
                "sync_daily_history: [%s ~ %s], %d focus symbols need backfill",
                start_date, today, len(need_history),
            )

            def _history_chunk_progress(cur: int, tot: int) -> None:
                emit(
                    "sync_daily_history",
                    46 + int(3 * cur / tot),
                    f"历史日K批次 {cur}/{tot}",
                    stage_pct=int(100 * cur / tot),
                    skip_log=True,
                )

            written_history = kline_sync.sync_and_persist_daily_batch(
                need_history,
                repo,
                capset,
                start_date=_dt.combine(start_date, _dt.min.time()),
                end_date=_dt.combine(today, _dt.min.time()),
                on_chunk_done=_history_chunk_progress,
            )
            if written_history > 0:
                written_daily += written_history
                new_daily_days = max(new_daily_days, FOCUS_HISTORY_BACKFILL_DAYS)
            emit("sync_daily_history", 49, f"历史日K补齐完成,{written_history} 行")
            logger.info("sync_daily_history: wrote %d rows", written_history)
    _invalidate("daily")

    # Step 1.5: 增量同步除权因子 — 从已有数据最新日期的下一天开始获取
    written_adj = 0
    affected_symbols: list[str] = []
    if capset.has(Cap.ADJ_FACTOR):
        from datetime import datetime, timedelta
        adj_end = datetime.now()
        # 从已有除权因子数据的最新日期开始获取，避免重复拉取
        adj_factor_path = repo.store.data_dir / "adj_factor" / "all.parquet"
        fallback_start = adj_end - timedelta(days=30)
        if adj_factor_path.exists():
            try:
                from datetime import date as date_cls
                max_date = pl.scan_parquet(adj_factor_path).select(
                    pl.col("trade_date").max()
                ).collect().item()
                if max_date is not None:
                    # trade_date 可能是 date / datetime / string 类型
                    if isinstance(max_date, str):
                        td = date_cls.fromisoformat(max_date)
                    elif isinstance(max_date, datetime):
                        td = max_date.date()
                    else:
                        td = max_date
                    adj_start = datetime.combine(td, datetime.min.time())
                else:
                    adj_start = fallback_start
            except Exception:
                adj_start = fallback_start
        else:
            adj_start = fallback_start
        adj_start_str = adj_start.strftime("%Y-%m-%d")
        adj_end_str = adj_end.strftime("%Y-%m-%d")
        emit("sync_adj", 50, f"获取除权因子 [{adj_start_str} ~ {adj_end_str}]…")
        logger.info("sync_adj: [%s ~ %s] start", adj_start_str, adj_end_str)

        def _adj_chunk_progress(cur: int, tot: int) -> None:
            emit("sync_adj", 50 + int(10 * cur / tot),
                 f"除权因子批次 {cur}/{tot}", stage_pct=int(100 * cur / tot), skip_log=True)
        written_adj, affected_symbols = kline_sync.sync_adj_factor(
            universe, repo, capset,
            start_time=adj_start, end_time=adj_end,
            on_chunk_done=_adj_chunk_progress,
        )
        if affected_symbols:
            _refresh_single_view(repo, "adj_factor")
            emit("sync_adj", 60, f"除权因子完成,新增 {len(affected_symbols)} 只个股")
            logger.info("sync_adj: [%s ~ %s] done, %d symbols", adj_start_str, adj_end_str, len(affected_symbols))
        else:
            emit("sync_adj", 60, "除权因子完成,无新增")
            logger.info("sync_adj: [%s ~ %s] no new factors", adj_start_str, adj_end_str)
        _invalidate("adj_factor")
    else:
        skipped.append("sync_adj")
        logger.info("sync_adj skipped: no ADJ_FACTOR capability")

    # Step 2: 计算 enriched
    #   判断策略:
    #     - 首次 (enriched 目录不存在) → 全量
    #     - 往前扩展历史 (新日期 < enriched 已有最早日期) → 全量
    #       前面的除权因子会改变累积因子链,影响后面所有日期的复权价格
    #     - 往后新增日期 (新日期 > enriched 已有最晚日期)
    #       → 增量补新区块(所有标的) + 受除权影响个股全日期重算
    #     - 无新日期 + 有新除权因子 → 增量: 只重算受影响个股的全部日期
    #     - 无新日期 + 无变化 → 跳过
    enriched_dir = repo.store.data_dir / "kline_daily_enriched"
    enriched_exists = enriched_dir.exists() and any(enriched_dir.glob("date=*"))
    daily_dir = repo.store.data_dir / "kline_daily"
    daily_days = len(list(daily_dir.glob("date=*"))) if daily_dir.exists() else 0
    prev_enriched_days = len(list(enriched_dir.glob("date=*"))) if enriched_exists else 0

    # 判断新日期方向: 找 daily 和 enriched 的日期集合做比较
    forward_incremental = False
    backward_extension = False

    if daily_days > prev_enriched_days and enriched_exists:
        daily_dates = sorted(d.stem.split("=")[1] for d in daily_dir.glob("date=*"))
        enriched_dates = sorted(d.stem.split("=")[1] for d in enriched_dir.glob("date=*"))
        earliest_enriched = enriched_dates[0]
        latest_enriched = enriched_dates[-1]
        new_dates = set(daily_dates) - set(enriched_dates)
        if new_dates:
            # 有新日期早于 enriched 最早日期 → 往前扩展
            if any(d < earliest_enriched for d in new_dates):
                backward_extension = True
            # 有新日期晚于 enriched 最晚日期 → 往后新增
            if any(d > latest_enriched for d in new_dates):
                forward_incremental = True

    def _enriched_batch_progress(cur: int, tot: int) -> None:
        emit("compute_enriched", 65 + int(23 * cur / tot),
             f"计算指标 批次 {cur}/{tot}", stage_pct=int(100 * cur / tot), skip_log=True)

    if not enriched_exists or backward_extension:
        # 首次 或 往前扩展: focus 只计算关注范围, market 才做全量。
        enriched_symbols = None if scope == "market" else universe
        emit(
            "compute_enriched",
            65,
            "全量计算 enriched…" if scope == "market" else f"计算关注范围 enriched ({len(universe)} 只)…",
        )
        logger.info("compute_enriched: full rebuild (first=%s, backward=%s, daily=%d, enriched=%d)",
                    not enriched_exists, backward_extension, daily_days, prev_enriched_days)
        written_enriched = run_pipeline(symbols=enriched_symbols, on_batch_done=_enriched_batch_progress)
        new_enriched_days = len(list(enriched_dir.glob("date=*")))
        emit("compute_enriched", 88, f"enriched 完成,覆盖 {new_enriched_days} 天")
        logger.info("compute_enriched: full rebuild done, %d days", new_enriched_days)
    elif forward_incremental:
        # 往后新增日期: market 走日期增量; focus 直接重算关注范围全日期,避免新分区误扫旧全市场数据。
        symbols_to_recompute = list(set(affected_symbols)) if affected_symbols else []
        if scope == "market":
            emit("compute_enriched", 65,
                 f"增量计算 enriched (新日期 + {len(symbols_to_recompute)} 只个股重算)…"
                 if symbols_to_recompute else "增量计算 enriched (新日期)…")
            logger.info("compute_enriched: forward incremental, %d symbols to recompute",
                        len(symbols_to_recompute))
            written_enriched = run_pipeline(
                new_dates_only=True,
                symbols=symbols_to_recompute or None,
                on_batch_done=_enriched_batch_progress,
            )
        else:
            focus_symbols = sorted(set(universe) | set(symbols_to_recompute))
            emit("compute_enriched", 65, f"计算关注范围 enriched ({len(focus_symbols)} 只)…")
            logger.info("compute_enriched: focus recompute, %d symbols", len(focus_symbols))
            written_enriched = run_pipeline(symbols=focus_symbols, on_batch_done=_enriched_batch_progress)
        new_enriched_days = len(list(enriched_dir.glob("date=*")))
        emit("compute_enriched", 88, f"enriched 完成,覆盖 {new_enriched_days} 天")
        logger.info("compute_enriched: forward incremental done, %d days", new_enriched_days)
    elif affected_symbols:
        # 无新日期,仅除权因子变更 → 只重算受影响个股的全部日期
        emit("compute_enriched", 65, f"增量计算 enriched ({len(affected_symbols)} 只个股)…")
        logger.info("compute_enriched: adj_factor incremental, %d symbols", len(affected_symbols))
        written_enriched = run_pipeline(symbols=affected_symbols, on_batch_done=_enriched_batch_progress)
        emit("compute_enriched", 88, f"enriched 完成,{len(affected_symbols)} 只个股")
    elif scope == "focus" and written_daily > 0:
        # 关注范围可能新增标的但没有新增日期；仍需重算该范围的 enriched。
        emit("compute_enriched", 65, f"计算关注范围 enriched ({len(universe)} 只)…")
        logger.info("compute_enriched: focus refresh after daily write, %d symbols", len(universe))
        written_enriched = run_pipeline(symbols=universe, on_batch_done=_enriched_batch_progress)
        emit("compute_enriched", 88, f"enriched 完成,{written_enriched} 行")
    else:
        written_enriched = 0
        logger.info("compute_enriched: skip (no new daily, no adj_factor changes)")
    _refresh_single_view(repo, "kline_enriched")
    _invalidate("enriched")

    # Step 2.3: 指数同步 — 独立 kline_index_* 存储，不进入股票选股/策略链路。
    written_index_daily = 0
    index_count = 0
    if capset.has(Cap.KLINE_DAILY_BATCH):
        index_symbols = None if scope == "market" else preferences.get_sidebar_index_symbols()
        emit("sync_index", 88, "同步指数列表与日K…" if scope == "market" else "同步基准指数日K…")
        try:
            index_count = index_sync.sync_index_instruments(repo)
            index_dir = repo.store.data_dir / "kline_index_enriched"
            index_dates = sorted(
                d.name[5:] for d in index_dir.glob("date=*")
                if d.is_dir() and d.name.startswith("date=")
            ) if index_dir.exists() else []
            index_start = _date.fromisoformat(index_dates[-1]) if index_dates else today - _td(days=365)
            written_index_daily = index_sync.sync_and_persist_index_daily(
                repo,
                capset,
                start_date=_dt.combine(index_start, _dt.min.time()),
                end_date=_dt.combine(today, _dt.min.time()),
                symbols=index_symbols,
            )
            repo.refresh_index_views()
            _invalidate("index_instruments")
            _invalidate("index_daily")
            _invalidate("index_enriched")
            emit("sync_index", 89, f"指数完成,{index_count} 只指数,{written_index_daily} 行日K")
        except Exception as e:  # noqa: BLE001
            logger.warning("sync_index failed: %s", e)
            emit("sync_index", 89, f"指数同步失败:{e}")
    else:
        skipped.append("sync_index")

    # Step 2.5: 分钟 K 同步(可选) — 未启用或无 capability 时静默跳过(不 emit)
    minute_on = preferences.get_minute_sync_enabled()
    minute_days = preferences.get_minute_sync_days()
    written_minute = 0
    if minute_on and capset.has(Cap.KLINE_MINUTE_BATCH):
        minute_start = today - _td(days=minute_days)
        emit("sync_minute", 90, f"获取分钟K [{minute_start} ~ {today}]…")
        logger.info("sync_minute: [%s ~ %s] start", minute_start, today)
        minute_symbols = _resolve_minute_symbols(capset, scope=scope)
        def _minute_chunk_progress(cur: int, tot: int) -> None:
            emit("sync_minute", 90 + int(3 * cur / tot),
                 f"分钟K 批次 {cur}/{tot}", stage_pct=int(100 * cur / tot), skip_log=True)
        written_minute = kline_sync.sync_and_persist_minute(
            minute_symbols, repo, capset, days=minute_days,
            on_chunk_done=_minute_chunk_progress,
        )
        minute_dir = repo.store.data_dir / "kline_minute"
        minute_cover_days = len(list(minute_dir.glob("date=*"))) if minute_dir.exists() else 0
        emit("sync_minute", 93, f"分钟K完成,覆盖 {minute_cover_days} 天")
        logger.info("sync_minute: [%s ~ %s] done, %d days", minute_start, today, minute_cover_days)
        _invalidate("minute")
    else:
        skipped.append("sync_minute")
        if minute_on:
            logger.info("sync_minute skipped: no KLINE_MINUTE_BATCH capability")
        else:
            logger.info("sync_minute skipped: user disabled")

    # Step 3: 刷新视图
    emit("refresh_views", 95, "刷新 DuckDB 视图…")
    _refresh_views(repo)

    emit("done", 100, "完成")
    _invalidate(None)  # 兜底:全清

    return {
        "scope": scope,
        "universe_size": len(universe),
        "daily_days": new_daily_days,
        "daily_rows": written_daily,
        "adj_factor_symbols": len(affected_symbols),
        "enriched_days": written_enriched,
        "index_count": index_count,
        "index_daily_rows": written_index_daily,
        "minute_rows": written_minute,
        "skipped_stages": skipped,
    }


def _run_akshare_now(
    repo: KlineRepository,
    capset: CapabilitySet,
    on_progress: ProgressCb | None = None,
    full_market: bool = False,
) -> dict:
    """Run the manual AkShare after-market pipeline.

    Phase 1 intentionally supports manual sync only. Scheduler registration skips
    this path for AkShare to avoid startup/cron network surprises.
    """
    from app.datasource.stage_matrix import unsupported_pipeline_stages
    from app.services import akshare_sync

    emit = on_progress or _noop
    skipped = unsupported_pipeline_stages("akshare")
    scope: UniverseScope = "market" if full_market else "focus"
    universe: list[str] | None = None
    universe_size = 0

    emit("sync_instruments", 2, "同步 AkShare 标的维表…")
    inst_rows = akshare_sync.sync_instruments(repo.store.data_dir)
    if inst_rows > 0:
        _refresh_instruments_view(repo)
        repo.refresh_cache()
    _invalidate("instruments")
    emit("sync_instruments", 8, f"标的维表同步完成,{inst_rows} 只标的")

    if scope == "focus":
        emit("resolve_universe", 9, "解析关注范围…")
        universe = _resolve_universe(capset, scope="focus")
        universe_size = len(universe)
        emit("resolve_universe", 10, f"关注范围规模:{universe_size} 只")

    emit(
        "sync_daily",
        10,
        f"同步 AkShare 最近 {settings.akshare_initial_years} 年日K…"
        if scope == "market"
        else f"同步 AkShare 关注范围日K ({universe_size} 只)…",
    )

    def _daily_progress(cur: int, tot: int) -> None:
        emit(
            "sync_daily",
            10 + int(45 * cur / max(tot, 1)),
            f"日K {cur}/{tot}",
            stage_pct=int(100 * cur / max(tot, 1)),
            skip_log=True,
        )

    written_daily, daily_failures = akshare_sync.sync_daily(
        repo,
        years=settings.akshare_initial_years,
        symbols=universe,
        full_market=scope == "market",
        on_chunk_done=_daily_progress,
    )
    _refresh_single_view(repo, "kline_daily")
    _invalidate("daily")
    emit("sync_daily", 55, f"日K 完成,{written_daily} 行,失败 {len(daily_failures)} 只")

    emit(
        "compute_enriched",
        60,
        "全量计算 enriched…" if scope == "market" else f"计算关注范围 enriched ({universe_size} 只)…",
    )
    written_enriched = run_pipeline(symbols=universe if scope == "focus" else None, on_batch_done=lambda cur, tot: emit(
        "compute_enriched",
        60 + int(25 * cur / max(tot, 1)),
        f"计算指标 批次 {cur}/{tot}",
        stage_pct=int(100 * cur / max(tot, 1)),
        skip_log=True,
    ))
    _refresh_single_view(repo, "kline_enriched")
    _invalidate("enriched")
    emit("compute_enriched", 85, f"enriched 完成,{written_enriched} 行")

    emit("sync_index", 88, "同步 AkShare 指数日K…")
    index_count, index_rows, index_failures = akshare_sync.sync_index(
        repo,
        years=settings.akshare_initial_years,
    )
    _invalidate("index_instruments")
    _invalidate("index_daily")
    _invalidate("index_enriched")
    emit("sync_index", 93, f"指数完成,{index_count} 只,{index_rows} 行,失败 {len(index_failures)} 只")

    emit("refresh_views", 95, "刷新 DuckDB 视图…")
    _refresh_views(repo)
    repo.refresh_cache()
    _invalidate(None)
    emit("done", 100, "完成")

    return {
        "provider": "akshare",
        "scope": scope,
        "universe_size": inst_rows if scope == "market" else universe_size,
        "daily_rows": written_daily,
        "daily_failures": daily_failures[:50],
        "daily_failure_count": len(daily_failures),
        "enriched_days": written_enriched,
        "index_count": index_count,
        "index_daily_rows": index_rows,
        "index_failures": index_failures,
        "minute_rows": 0,
        "skipped_stages": skipped,
    }


def _refresh_views(repo: KlineRepository) -> None:
    """刷新所有 DuckDB 视图。"""
    d = repo.store.data_dir.as_posix()
    views = {
        "kline_daily": f"{d}/kline_daily/**/*.parquet",
        "kline_enriched": f"{d}/kline_daily_enriched/**/*.parquet",
        "kline_index_daily": f"{d}/kline_index_daily/**/*.parquet",
        "kline_index_enriched": f"{d}/kline_index_enriched/**/*.parquet",
        "kline_minute": f"{d}/kline_minute/**/*.parquet",
        "adj_factor": f"{d}/adj_factor/**/*.parquet",
        "instruments": f"{d}/instruments/**/*.parquet",
        "instruments_index": f"{d}/instruments_index/**/*.parquet",
    }
    for name, path in views.items():
        try:
            repo.db.execute(
                f"CREATE OR REPLACE VIEW {name} AS "
                f"SELECT * FROM read_parquet('{path}', union_by_name=true)"
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("refresh view %s failed: %s", name, e)


def _refresh_single_view(repo: KlineRepository, name: str) -> None:
    """刷新单个 DuckDB 视图。"""
    d = repo.store.data_dir.as_posix()
    paths = {
        "kline_daily": f"{d}/kline_daily/**/*.parquet",
        "kline_enriched": f"{d}/kline_daily_enriched/**/*.parquet",
        "kline_index_daily": f"{d}/kline_index_daily/**/*.parquet",
        "kline_index_enriched": f"{d}/kline_index_enriched/**/*.parquet",
        "kline_minute": f"{d}/kline_minute/**/*.parquet",
        "adj_factor": f"{d}/adj_factor/**/*.parquet",
        "instruments": f"{d}/instruments/**/*.parquet",
        "instruments_index": f"{d}/instruments_index/**/*.parquet",
    }
    path = paths.get(name)
    if not path:
        return
    try:
        repo.db.execute(
            f"CREATE OR REPLACE VIEW {name} AS "
            f"SELECT * FROM read_parquet('{path}', union_by_name=true)"
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("refresh view %s failed: %s", name, e)


def _resolve_minute_symbols(capset: CapabilitySet, scope: UniverseScope = "focus") -> list[str]:
    """分钟 K 同步标的 — 与日K共用同一标的池。"""
    return _resolve_universe(capset, scope=scope)


def _refresh_instruments_view(repo: KlineRepository) -> None:
    """单独刷新 instruments 视图。"""
    d = repo.store.data_dir.as_posix()
    try:
        repo.db.execute(
            f"CREATE OR REPLACE VIEW instruments AS "
            f"SELECT * FROM read_parquet('{d}/instruments/**/*.parquet', union_by_name=true)"
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("refresh instruments view failed: %s", e)


def _run_tracked(fn, job_label: str) -> None:
    """调度触发时包装 JobStore 跟踪，确保同步历史有记录。"""
    from app.services.pipeline_jobs import job_store

    job_id = job_store.create()
    job_store.start(job_id)

    def progress(stage: str, pct: int, msg: str, stage_pct: int | None = None,
                 skip_log: bool = False) -> None:
        job_store.progress(job_id, stage, pct, msg, stage_pct=stage_pct, skip_log=skip_log)

    try:
        result = fn(on_progress=progress)
        job_store.succeed(job_id, result)
        logger.info("scheduled %s completed: job_id=%s", job_label, job_id)
    except Exception:
        logger.exception("scheduled %s failed: job_id=%s", job_label, job_id)
        job_store.fail(job_id, f"scheduled {job_label} failed")


def configure_scheduler_jobs(
    scheduler: AsyncIOScheduler,
    repo: KlineRepository,
    capset: CapabilitySet,
) -> None:
    """按当前 provider/capability 重建盘前盘后调度任务。"""
    from app.services import preferences
    sched = preferences.get_pipeline_schedule()
    inst_sched = preferences.get_instruments_schedule()

    for job_id in _SCHEDULER_JOB_IDS:
        try:
            scheduler.remove_job(job_id)
        except Exception:
            pass

    if settings.provider_is_akshare:
        logger.info("scheduler configured in AkShare mode; provider network sync is manual-only")
        return

    # 盘前: 同步 instruments（时间由偏好决定）
    def _instruments_task(on_progress=None):
        emit = on_progress or _noop
        emit("sync_instruments", 0, "同步标的维表…")
        result = run_instruments_sync(repo)
        emit("done", 100, f"标的维表同步完成,{result.get('instruments_rows', 0)} 只标的")
        return result

    scheduler.add_job(
        lambda: _run_tracked(_instruments_task, "instruments_sync"),
        trigger=CronTrigger(day_of_week="mon-fri",
                            hour=inst_sched["hour"], minute=inst_sched["minute"],
                            timezone="Asia/Shanghai"),
        id="pre_market_instruments",
        misfire_grace_time=1800,
        replace_existing=True,
    )

    # 盘后: 日 K + enriched（时间由偏好决定）
    scheduler.add_job(
        lambda: _run_tracked(
            lambda on_progress=None: run_now(repo, capset, on_progress=on_progress),
            "daily_pipeline",
        ),
        trigger=CronTrigger(day_of_week="mon-fri",
                            hour=sched["hour"], minute=sched["minute"],
                            timezone="Asia/Shanghai"),
        id="daily_pipeline",
        misfire_grace_time=3600,
        replace_existing=True,
    )

    # 盘后: 五档盘口 sealed 定版(时间由偏好决定, 默认15:02, 范围15:01~18:00)
    depth_sched = preferences.get_depth_finalize_time()

    def _depth_finalize():
        depth_svc = getattr(_get_app_state(), "depth_service", None) if _get_app_state() else None
        if depth_svc:
            depth_svc.finalize()

    scheduler.add_job(
        _depth_finalize,
        trigger=CronTrigger(day_of_week="mon-fri",
                            hour=depth_sched["hour"], minute=depth_sched["minute"],
                            timezone="Asia/Shanghai"),
        id="depth_finalize",
        misfire_grace_time=3600,
        replace_existing=True,
    )

    scheduler.start()
    logger.info("scheduler started; instruments@%02d:%02d, pipeline@%02d:%02d, depth@%02d:%02d mon-fri",
                inst_sched["hour"], inst_sched["minute"], sched["hour"], sched["minute"],
                depth_sched["hour"], depth_sched["minute"])


def start_scheduler(repo: KlineRepository, capset: CapabilitySet) -> AsyncIOScheduler:
    """启动调度器。

    工作日 09:10 — 同步标的维表
    工作日 HH:MM — 盘后管道（时间由用户偏好决定，默认 15:30）
    """
    scheduler = AsyncIOScheduler(timezone="Asia/Shanghai")
    configure_scheduler_jobs(scheduler, repo, capset)
    scheduler.start()
    return scheduler


# app_state 延迟引用(start_scheduler 在 lifespan 早期调用, app.state 可能还没就绪)
_app_state_ref = None


def set_app_state(app_state) -> None:
    """lifespan 注册 app.state 引用, 供 scheduled job 访问 depth_service 等单例。"""
    global _app_state_ref
    _app_state_ref = app_state


def _get_app_state():
    return _app_state_ref
