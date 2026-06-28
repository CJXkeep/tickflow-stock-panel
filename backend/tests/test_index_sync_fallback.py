from datetime import datetime

import polars as pl

from app.services import index_sync
from app.tickflow.capabilities import Cap, CapabilityLimits, CapabilitySet


class FakeRepo:
    def __init__(self) -> None:
        self.daily_frames: list[pl.DataFrame] = []
        self.enriched_frames: list[pl.DataFrame] = []
        self.refresh_count = 0

    def get_index_instruments(self) -> pl.DataFrame:
        return pl.DataFrame({
            "symbol": ["000001.SH", "399001.SZ"],
            "name": ["上证指数", "深证成指"],
        })

    def append_index_daily(self, df: pl.DataFrame) -> None:
        self.daily_frames.append(df)

    def append_index_enriched(self, df: pl.DataFrame) -> None:
        self.enriched_frames.append(df)

    def refresh_index_views(self) -> None:
        self.refresh_count += 1


class FakeAkShareSource:
    def index_daily(self, symbol, start, end):  # noqa: ANN001
        return pl.DataFrame({
            "symbol": [symbol, symbol],
            "date": [start, end],
            "open": [100.0, 101.0],
            "high": [102.0, 103.0],
            "low": [99.0, 100.0],
            "close": [101.0, 102.0],
            "volume": [1000.0, 1100.0],
            "amount": [100000.0, 110000.0],
        })


def test_index_daily_sync_falls_back_to_akshare_when_tickflow_returns_empty(monkeypatch):
    repo = FakeRepo()
    capset = CapabilitySet({Cap.KLINE_DAILY_BATCH: CapabilityLimits(batch=100)})

    monkeypatch.setattr(index_sync.kline_sync, "sync_daily_batch", lambda *args, **kwargs: pl.DataFrame())
    monkeypatch.setattr(index_sync.preferences, "get_index_daily_batch_size", lambda: 100)
    monkeypatch.setattr(index_sync, "compute_enriched", lambda raw, factors=None, instruments=None: raw)

    import app.datasource.akshare_source as akshare_source

    monkeypatch.setattr(akshare_source, "AkShareSource", FakeAkShareSource)

    rows = index_sync.sync_and_persist_index_daily(
        repo,
        capset,
        start_date=datetime(2026, 1, 1),
        end_date=datetime(2026, 1, 2),
        symbols=["000001.SH", "399001.SZ"],
    )

    assert rows == 4
    assert len(repo.daily_frames) == 2
    assert len(repo.enriched_frames) == 2
    assert {df["symbol"][0] for df in repo.daily_frames} == {"000001.SH", "399001.SZ"}
    assert repo.refresh_count >= 1
