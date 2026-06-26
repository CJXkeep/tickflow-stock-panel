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


def _add_symbol(out: set[str], value: object) -> None:
    symbol = str(value or "").strip()
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
    return [str(s) for s in df["symbol"].head(limit).to_list() if s]


def resolve_focus_universe(
    data_dir: Path | None = None,
    *,
    local_fallback_limit: int = DEFAULT_LOCAL_FALLBACK_LIMIT,
    alert_limit: int = DEFAULT_ALERT_LIMIT,
) -> list[str]:
    """Return the default focus universe without remote all-market calls."""
    d = Path(data_dir or settings.data_dir)
    symbols: set[str] = set()

    try:
        symbols.update(get_pool("watchlist"))
    except Exception as e:  # noqa: BLE001
        logger.warning("focus universe watchlist scan failed: %s", e)

    rule_symbols, rule_strategy_ids = _symbols_from_monitor_rules(d)
    symbols.update(rule_symbols)

    strategy_ids = set(preferences.get_strategy_monitor_ids())
    strategy_ids.update(rule_strategy_ids)
    symbols.update(_symbols_from_strategy_cache(d, strategy_ids))
    symbols.update(_recent_alert_symbols(d, alert_limit))

    if not symbols:
        symbols.update(_local_instrument_symbols(d, local_fallback_limit))
    if not symbols:
        symbols.update(DEMO_SYMBOLS)

    return sorted(symbols)
