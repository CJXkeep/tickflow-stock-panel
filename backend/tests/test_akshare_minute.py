from datetime import date, datetime

import polars as pl

from app.datasource.akshare_source import AkShareSource


def test_akshare_minute_normalization_accepts_eastmoney_columns():
    raw = pl.DataFrame({
        "时间": ["2026-06-26 09:31:00", "2026-06-26 15:01:00", "2026-06-25 10:00:00"],
        "开盘": ["10.1", "10.3", "9.9"],
        "最高": ["10.2", "10.4", "10.0"],
        "最低": ["10.0", "10.2", "9.8"],
        "收盘": ["10.2", "10.35", "9.95"],
        "成交量": ["1200", "800", "500"],
        "成交额": ["12240", "8280", "4975"],
    })

    df = AkShareSource._normalize_minute(raw, "000001.SZ", date(2026, 6, 26))

    assert df.height == 2
    assert df["symbol"].to_list() == ["000001.SZ", "000001.SZ"]
    assert df["datetime"].to_list()[0] == datetime(2026, 6, 26, 9, 31)
    assert df["close"].to_list() == [10.2, 10.35]
