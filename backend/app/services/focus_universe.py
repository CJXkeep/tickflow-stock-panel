"""Resolve the small default symbol set used by daily focus sync."""
from __future__ import annotations

import logging
from pathlib import Path

import polars as pl

from app.config import settings
from app.services import alert_store, preferences, strategy_cache
from app.strategy import monitor_rules
from app.tickflow.pools import DEMO_SYMBOLS, get_pool

logger = logging.getLogger(__name__)

DEFAULT_LOCAL_FALLBACK_LIMIT = 30
DEFAULT_ALERT_LIMIT = 200
SOURCE_LABELS = {
    "watchlist": "观察池",
    "monitor_rules": "监控规则",
    "strategy_tracking": "策略跟踪",
    "recent_alerts": "最近告警",
    "local_fallback": "本地维表兜底",
    "demo": "示例标的",
    "manual_include": "手动追加",
}


def _add_symbol(out: set[str], value: object) -> None:
    symbol = str(value or "").strip().upper()
    if symbol:
        out.add(symbol)


def _symbols_from_strategy_cache(data_dir: Path, strategy_ids: set[str]) -> set[str]:
    if not strategy_ids:
        return set()
    cached = strategy_cache.read_cache(data_dir) or {}
    out: set[str] = set()

    for sid in strategy_ids:
        for symbol in (cached.get("today_ever_matched") or {}).get(sid, []) or []:
            _add_symbol(out, symbol)
        result = (cached.get("results") or {}).get(sid) or {}
        for row in result.get("rows", []) or []:
            _add_symbol(out, row.get("symbol"))
    return out


def _symbols_from_monitor_rules(data_dir: Path) -> tuple[set[str], set[str]]:
    symbols: set[str] = set()
    strategy_ids: set[str] = set()
    try:
        rules = monitor_rules.load_all(data_dir)
    except Exception as e:  # noqa: BLE001
        logger.warning("focus universe monitor rule scan failed: %s", e)
        return symbols, strategy_ids

    for rule in rules:
        if rule.get("enabled") is False:
            continue
        if rule.get("scope") == "symbols":
            for symbol in rule.get("symbols") or []:
                _add_symbol(symbols, symbol)
        if rule.get("type") == "strategy":
            _add_symbol(strategy_ids, rule.get("strategy_id"))
    return symbols, strategy_ids


def _recent_alert_symbols(data_dir: Path, limit: int) -> set[str]:
    out: set[str] = set()
    try:
        events = alert_store.list_recent(data_dir, limit=limit)
    except Exception as e:  # noqa: BLE001
        logger.warning("focus universe alert scan failed: %s", e)
        return out
    for event in events:
        _add_symbol(out, event.get("symbol"))
    return out


def _local_instrument_symbols(data_dir: Path, limit: int) -> list[str]:
    if limit <= 0:
        return []
    inst_path = data_dir / "instruments" / "instruments.parquet"
    if not inst_path.exists():
        return []
    try:
        df = pl.read_parquet(inst_path, columns=["symbol"])
    except Exception as e:  # noqa: BLE001
        logger.warning("focus universe instrument fallback failed: %s", e)
        return []
    if df.is_empty() or "symbol" not in df.columns:
        return []
    return [str(s).upper() for s in df["symbol"].head(limit).to_list() if s]


def _add_source(by_source: dict[str, list[str]], key: str, symbols: set[str] | list[str]) -> None:
    by_source[key] = sorted({str(s).strip().upper() for s in symbols if str(s or "").strip()})


def resolve_focus_universe(
    data_dir: Path | None = None,
    *,
    local_fallback_limit: int = DEFAULT_LOCAL_FALLBACK_LIMIT,
    alert_limit: int = DEFAULT_ALERT_LIMIT,
) -> list[str]:
    """Return the default focus universe without remote all-market calls."""
    return resolve_focus_universe_detail(
        data_dir,
        local_fallback_limit=local_fallback_limit,
        alert_limit=alert_limit,
    )["symbols"]


def resolve_focus_universe_detail(
    data_dir: Path | None = None,
    *,
    local_fallback_limit: int = DEFAULT_LOCAL_FALLBACK_LIMIT,
    alert_limit: int = DEFAULT_ALERT_LIMIT,
) -> dict:
    """Return focus symbols plus source-level detail for settings preview."""
    d = Path(data_dir or settings.data_dir)
    cfg = preferences.get_focus_universe_config()
    sources = cfg["sources"]
    local_fallback_limit = cfg.get("local_fallback_limit", local_fallback_limit)
    alert_limit = cfg.get("alert_limit", alert_limit)
    symbols: set[str] = set()
    by_source: dict[str, list[str]] = {}

    if sources.get("watchlist", True):
        try:
            watchlist_symbols = {str(s).upper() for s in get_pool("watchlist")}
            symbols.update(watchlist_symbols)
            _add_source(by_source, "watchlist", watchlist_symbols)
        except Exception as e:  # noqa: BLE001
            logger.warning("focus universe watchlist scan failed: %s", e)

    rule_strategy_ids: set[str] = set()
    if sources.get("monitor_rules", True) or sources.get("strategy_tracking", True):
        rule_symbols, rule_strategy_ids = _symbols_from_monitor_rules(d)
        if sources.get("monitor_rules", True):
            symbols.update(rule_symbols)
            _add_source(by_source, "monitor_rules", rule_symbols)

    if sources.get("strategy_tracking", True):
        strategy_ids = set(preferences.get_strategy_monitor_ids())
        strategy_ids.update(rule_strategy_ids)
        strategy_symbols = _symbols_from_strategy_cache(d, strategy_ids)
        symbols.update(strategy_symbols)
        _add_source(by_source, "strategy_tracking", strategy_symbols)

    if sources.get("recent_alerts", True):
        alert_symbols = _recent_alert_symbols(d, alert_limit)
        symbols.update(alert_symbols)
        _add_source(by_source, "recent_alerts", alert_symbols)

    manual_include = set(cfg.get("include_symbols") or [])
    symbols.update(manual_include)
    _add_source(by_source, "manual_include", manual_include)

    fallback_used: str | None = None
    if not symbols and sources.get("local_fallback", True):
        fallback_symbols = _local_instrument_symbols(d, local_fallback_limit)
        symbols.update(fallback_symbols)
        _add_source(by_source, "local_fallback", fallback_symbols)
        fallback_used = "local_fallback" if fallback_symbols else None
    if not symbols and sources.get("demo", True):
        demo_symbols = [str(s).upper() for s in DEMO_SYMBOLS]
        symbols.update(demo_symbols)
        _add_source(by_source, "demo", demo_symbols)
        fallback_used = "demo"

    excluded = set(cfg.get("exclude_symbols") or [])
    final_symbols = sorted(symbols - excluded)
    by_source_counts = {key: len(values) for key, values in by_source.items()}

    return {
        "symbols": final_symbols,
        "count": len(final_symbols),
        "by_source": by_source,
        "by_source_counts": by_source_counts,
        "excluded_symbols": sorted(excluded),
        "fallback_used": fallback_used,
        "config": cfg,
        "source_labels": SOURCE_LABELS,
    }
