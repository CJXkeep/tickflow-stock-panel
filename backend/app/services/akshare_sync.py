"""AkShare synchronization service for the free after-market provider."""
from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

import polars as pl

from app.config import settings
from app.datasource.akshare_source import AkShareSource
from app.indicators.pipeline import compute_enriched
from app.tickflow.repository import KlineRepository

logger = logging.getLogger(__name__)


ProgressCb = Callable[[int, int], None]


def _short_error(e: Exception) -> str:
    text = str(e)
    if "ProxyError" in text:
        return "proxy connection failed"
    if "Max retries exceeded" in text:
        return "max retries exceeded"
    if "Read timed out" in text or "ConnectTimeout" in text:
        return "request timed out"
    return text[:300]


def _local_daily_span_by_symbol(repo: KlineRepository) -> dict[str, tuple[date, date]]:
    daily_dir = repo.store.data_dir / "kline_daily"
    if not daily_dir.exists() or not any(daily_dir.rglob("*.parquet")):
        return {}
    try:
        df = (
            pl.scan_parquet(str(daily_dir / "**" / "*.parquet"))
            .select(["symbol", "date"])
            .group_by("symbol")
            .agg(
                pl.col("date").min().alias("earliest"),
                pl.col("date").max().alias("latest"),
            )
            .collect()
        )
    except Exception as e:  # noqa: BLE001
        logger.debug("akshare local daily span scan skipped: %s", e)
        return {}
    out: dict[str, tuple[date, date]] = {}
    for row in df.iter_rows(named=True):
        earliest = row.get("earliest")
        latest = row.get("latest")
        if earliest and latest:
            earliest_date = earliest if isinstance(earliest, date) else date.fromisoformat(str(earliest))
            latest_date = latest if isinstance(latest, date) else date.fromisoformat(str(latest))
            out[str(row["symbol"])] = (earliest_date, latest_date)
    return out


def sync_instruments(data_dir) -> int:
    source = AkShareSource()
    df = source.list_stocks()
    if df.is_empty():
        return 0
    out = data_dir / "instruments" / "instruments.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(out)
    logger.info("akshare instruments synced: %d rows", df.height)
    return df.height


def sync_daily(repo: KlineRepository, years: int | None = None, on_chunk_done: ProgressCb | None = None) -> tuple[int, list[str]]:
    instruments = repo.get_instruments()
    if instruments.is_empty() or "symbol" not in instruments.columns:
        return 0, []

    symbols = sorted(set(instruments["symbol"].cast(pl.Utf8).to_list()))
    end = date.today()
    history_start = end - timedelta(days=365 * (years or settings.akshare_initial_years))
    span_by_symbol = _local_daily_span_by_symbol(repo)
    failures: list[str] = []
    written = 0
    done = 0
    pending: list[pl.DataFrame] = []
    max_workers = max(1, int(settings.akshare_max_workers))
    write_batch_size = max(1, int(settings.akshare_write_batch_size))

    def flush_pending() -> None:
        nonlocal written, pending
        if not pending:
            return
        df = pl.concat(pending, how="diagonal_relaxed")
        repo.append_daily(df)
        written += df.height
        pending = []

    def fetch_symbol(symbol: str) -> tuple[str, date, pl.DataFrame | None, Exception | None]:
        span = span_by_symbol.get(symbol)
        if span is None or span[0] > history_start:
            start = history_start
        else:
            start = max(history_start, span[1] - timedelta(days=7))
        try:
            return symbol, start, AkShareSource().stock_daily(symbol, start, end), None
        except Exception as e:  # noqa: BLE001
            return symbol, start, None, e

    with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="akshare-daily") as pool:
        futures = [pool.submit(fetch_symbol, symbol) for symbol in symbols]
        for future in as_completed(futures):
            symbol, start, df, error = future.result()
            done += 1
            if error is not None:
                failures.append(symbol)
                logger.warning("akshare daily failed: symbol=%s range=%s..%s error=%s", symbol, start, end, _short_error(error))
            elif df is not None and not df.is_empty():
                pending.append(df)
                if len(pending) >= write_batch_size:
                    flush_pending()
            if on_chunk_done:
                on_chunk_done(done, len(symbols))

    flush_pending()

    logger.info(
        "akshare daily synced: %d rows, %d failures, workers=%d, write_batch=%d",
        written,
        len(failures),
        max_workers,
        write_batch_size,
    )
    return written, failures


def sync_index(repo: KlineRepository, years: int | None = None) -> tuple[int, int, list[str]]:
    source = AkShareSource()
    instruments = source.index_instruments()
    repo.save_index_instruments(instruments)

    end = date.today()
    start = end - timedelta(days=365 * (years or settings.akshare_initial_years))
    failures: list[str] = []
    rows = 0

    for item in instruments.iter_rows(named=True):
        symbol = item["symbol"]
        try:
            raw = source.index_daily(symbol, start, end)
            if raw.is_empty():
                continue
            repo.append_index_daily(raw)
            enriched = compute_enriched(raw, factors=None, instruments=None)
            repo.append_index_enriched(enriched)
            rows += raw.height
        except Exception as e:  # noqa: BLE001
            failures.append(symbol)
            logger.warning("akshare index daily failed: symbol=%s range=%s..%s error=%s", symbol, start, end, e)

    repo.refresh_index_views()
    logger.info("akshare index synced: %d indices, %d rows, %d failures", instruments.height, rows, len(failures))
    return instruments.height, rows, failures
