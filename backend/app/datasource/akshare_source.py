"""AkShare provider implementation for free after-market A-share data."""
from __future__ import annotations

import logging
from datetime import date, datetime

import polars as pl

from app.datasource.base import normalize_cn_symbol, symbol_to_ak_code, symbol_to_ak_index
from app.indicators.pipeline import filter_halt_days

logger = logging.getLogger(__name__)


CORE_INDEXES = [
    ("000001.SH", "上证指数"),
    ("399001.SZ", "深证成指"),
    ("399006.SZ", "创业板指"),
    ("000300.SH", "沪深300"),
    ("000905.SH", "中证500"),
    ("000016.SH", "上证50"),
    ("000852.SH", "中证1000"),
]


def _ak():
    try:
        import akshare as ak  # type: ignore
    except Exception as e:  # noqa: BLE001
        raise RuntimeError("AkShare is not installed. Run backend dependency sync first.") from e
    return ak


def _from_pandas(df) -> pl.DataFrame:
    if df is None or len(df) == 0:
        return pl.DataFrame()
    return pl.from_pandas(df.reset_index() if hasattr(df, "reset_index") else df)


class AkShareSource:
    """Small wrapper around AkShare with project-level normalization."""

    def list_stocks(self) -> pl.DataFrame:
        ak = _ak()
        raw = _from_pandas(ak.stock_info_a_code_name())
        if raw.is_empty():
            return raw

        rename = {"code": "code", "代码": "code", "name": "name", "名称": "name"}
        raw = raw.rename({k: v for k, v in rename.items() if k in raw.columns})
        if "code" not in raw.columns:
            return pl.DataFrame()
        if "name" not in raw.columns:
            raw = raw.with_columns(pl.col("code").cast(pl.Utf8).alias("name"))

        df = raw.select(
            pl.col("code").cast(pl.Utf8).str.zfill(6).alias("code"),
            pl.col("name").cast(pl.Utf8).alias("name"),
        ).with_columns(
            pl.col("code").map_elements(normalize_cn_symbol, return_dtype=pl.Utf8).alias("symbol"),
            pl.lit("stock").alias("type"),
            pl.lit(date.today()).alias("as_of"),
        ).with_columns(
            pl.col("symbol").str.split(".").list.get(1).alias("exchange"),
            pl.lit(None).cast(pl.Utf8).alias("listing_date"),
            pl.lit(None).cast(pl.Utf8).alias("industry"),
            pl.lit(None).cast(pl.Float64).alias("total_shares"),
            pl.lit(None).cast(pl.Float64).alias("float_shares"),
        )

        industry_map = self._industry_map(ak)
        if industry_map:
            df = df.with_columns(
                pl.col("symbol")
                .map_elements(lambda symbol: industry_map.get(symbol), return_dtype=pl.Utf8)
                .alias("industry")
            )

        return df.select([
            "symbol", "name", "code", "exchange", "type",
            "listing_date", "industry", "total_shares", "float_shares", "as_of",
        ]).unique(subset=["symbol"], keep="last").sort("symbol")

    def stock_daily(self, symbol: str, start: date, end: date) -> pl.DataFrame:
        ak = _ak()
        code = symbol_to_ak_code(symbol)
        raw = _from_pandas(ak.stock_zh_a_hist(
            symbol=code,
            period="daily",
            start_date=start.strftime("%Y%m%d"),
            end_date=end.strftime("%Y%m%d"),
            adjust="qfq",
        ))
        if raw.is_empty():
            return raw
        return self._normalize_daily(raw, normalize_cn_symbol(symbol))

    def stock_minute(self, symbol: str, trade_date: date) -> pl.DataFrame:
        """Best-effort single-stock 1m bars for chart fallback only."""
        ak = _ak()
        norm = normalize_cn_symbol(symbol)
        code = symbol_to_ak_code(norm)
        start_dt = datetime(trade_date.year, trade_date.month, trade_date.day, 9, 25)
        end_dt = datetime(trade_date.year, trade_date.month, trade_date.day, 15, 5)

        frames: list[pl.DataFrame] = []
        try:
            raw = _from_pandas(ak.stock_zh_a_hist_min_em(
                symbol=code,
                period="1",
                start_date=start_dt.strftime("%Y-%m-%d %H:%M:%S"),
                end_date=end_dt.strftime("%Y-%m-%d %H:%M:%S"),
                adjust="",
            ))
            frames.append(raw)
        except TypeError:
            try:
                raw = _from_pandas(ak.stock_zh_a_hist_min_em(
                    symbol=code,
                    period="1",
                    adjust="",
                ))
                frames.append(raw)
            except Exception as e:  # noqa: BLE001
                logger.warning("akshare stock minute fallback failed: symbol=%s error=%s", norm, e)
        except Exception as e:  # noqa: BLE001
            logger.warning("akshare stock minute failed: symbol=%s date=%s error=%s", norm, trade_date, e)

        if not frames or all(frame.is_empty() for frame in frames):
            try:
                raw = _from_pandas(ak.stock_zh_a_minute(
                    symbol=self._ak_stock_with_prefix(norm),
                    period="1",
                    adjust="",
                ))
                frames.append(raw)
            except Exception as e:  # noqa: BLE001
                logger.warning("akshare legacy minute failed: symbol=%s error=%s", norm, e)

        for raw in frames:
            df = self._normalize_minute(raw, norm, trade_date)
            if not df.is_empty():
                return df
        return pl.DataFrame()

    def index_instruments(self) -> pl.DataFrame:
        rows = [
            {
                "symbol": symbol,
                "name": name,
                "code": symbol.split(".", 1)[0],
                "asset_type": "index",
            }
            for symbol, name in CORE_INDEXES
        ]
        return pl.DataFrame(rows)

    def index_daily(self, symbol: str, start: date, end: date) -> pl.DataFrame:
        ak = _ak()
        ak_symbol = symbol_to_ak_index(symbol)
        raw = _from_pandas(ak.stock_zh_index_daily_em(symbol=ak_symbol))
        if raw.is_empty():
            return raw
        df = self._normalize_daily(raw, normalize_cn_symbol(symbol))
        if df.is_empty():
            return df
        return df.filter((pl.col("date") >= start) & (pl.col("date") <= end))

    @staticmethod
    def _normalize_daily(df: pl.DataFrame, symbol: str) -> pl.DataFrame:
        rename = {
            "日期": "date",
            "date": "date",
            "开盘": "open",
            "open": "open",
            "收盘": "close",
            "close": "close",
            "最高": "high",
            "high": "high",
            "最低": "low",
            "low": "low",
            "成交量": "volume",
            "volume": "volume",
            "成交额": "amount",
            "amount": "amount",
            "换手率": "turnover_rate",
        }
        df = df.rename({k: v for k, v in rename.items() if k in df.columns})
        if "date" not in df.columns:
            return pl.DataFrame()
        if "symbol" not in df.columns:
            df = df.with_columns(pl.lit(symbol).alias("symbol"))

        for col in ("open", "high", "low", "close", "volume", "amount", "turnover_rate"):
            if col in df.columns:
                df = df.with_columns(pl.col(col).cast(pl.Float64, strict=False))

        df = df.with_columns(
            pl.col("date").cast(pl.Date, strict=False),
            pl.col("symbol").cast(pl.Utf8).map_elements(normalize_cn_symbol, return_dtype=pl.Utf8).alias("symbol"),
        )
        keep = [c for c in ["symbol", "date", "open", "high", "low", "close", "volume", "amount", "turnover_rate"] if c in df.columns]
        return filter_halt_days(df.select(keep).drop_nulls(subset=["symbol", "date"])).sort(["symbol", "date"])

    @staticmethod
    def _ak_stock_with_prefix(symbol: str) -> str:
        norm = normalize_cn_symbol(symbol)
        code, _, suffix = norm.partition(".")
        prefix = "sh" if suffix == "SH" else "bj" if suffix == "BJ" else "sz"
        return f"{prefix}{code}"

    @staticmethod
    def _normalize_minute(df: pl.DataFrame, symbol: str, trade_date: date) -> pl.DataFrame:
        if df.is_empty():
            return df
        rename = {
            "时间": "datetime",
            "日期": "datetime",
            "day": "datetime",
            "trade_time": "datetime",
            "开盘": "open",
            "open": "open",
            "收盘": "close",
            "close": "close",
            "最高": "high",
            "high": "high",
            "最低": "low",
            "low": "low",
            "成交量": "volume",
            "volume": "volume",
            "成交额": "amount",
            "amount": "amount",
        }
        df = df.rename({k: v for k, v in rename.items() if k in df.columns})
        if "datetime" not in df.columns:
            return pl.DataFrame()

        if df.schema["datetime"] == pl.Utf8:
            df = df.with_columns(
                pl.coalesce([
                    pl.col("datetime").str.strptime(pl.Datetime("us"), "%Y-%m-%d %H:%M:%S", strict=False),
                    pl.col("datetime").str.strptime(pl.Datetime("us"), "%Y-%m-%d %H:%M", strict=False),
                    pl.col("datetime").str.strptime(pl.Datetime("us"), "%Y/%m/%d %H:%M:%S", strict=False),
                    pl.col("datetime").str.strptime(pl.Datetime("us"), "%Y/%m/%d %H:%M", strict=False),
                ]).alias("datetime")
            )
        else:
            df = df.with_columns(pl.col("datetime").cast(pl.Datetime("us"), strict=False))

        if "symbol" not in df.columns:
            df = df.with_columns(pl.lit(symbol).alias("symbol"))
        else:
            df = df.with_columns(
                pl.col("symbol").cast(pl.Utf8).map_elements(
                    lambda value: normalize_cn_symbol(value or symbol),
                    return_dtype=pl.Utf8,
                )
            )

        for col in ("open", "high", "low", "close", "volume", "amount"):
            if col in df.columns:
                df = df.with_columns(pl.col(col).cast(pl.Float64, strict=False))

        start_dt = datetime(trade_date.year, trade_date.month, trade_date.day, 9, 25)
        end_dt = datetime(trade_date.year, trade_date.month, trade_date.day, 15, 5)
        keep = [c for c in ["symbol", "datetime", "open", "high", "low", "close", "volume", "amount"] if c in df.columns]
        return (
            df.select(keep)
            .drop_nulls(subset=["symbol", "datetime", "close"])
            .filter((pl.col("datetime") >= start_dt) & (pl.col("datetime") <= end_dt))
            .sort(["symbol", "datetime"])
        )

    @staticmethod
    def _industry_map(ak) -> dict[str, str]:
        """Best-effort stock -> industry map from AkShare Eastmoney board data."""
        try:
            boards = _from_pandas(ak.stock_board_industry_name_em())
        except Exception as e:  # noqa: BLE001
            logger.warning("akshare industry board list failed: %s", e)
            return {}
        if boards.is_empty():
            return {}

        rename = {
            "板块名称": "industry",
            "行业名称": "industry",
            "name": "industry",
        }
        boards = boards.rename({k: v for k, v in rename.items() if k in boards.columns})
        if "industry" not in boards.columns:
            return {}

        mapping: dict[str, str] = {}
        for industry in boards["industry"].cast(pl.Utf8).drop_nulls().unique().to_list():
            try:
                cons = _from_pandas(ak.stock_board_industry_cons_em(symbol=industry))
            except Exception as e:  # noqa: BLE001
                logger.warning("akshare industry constituents failed: industry=%s error=%s", industry, e)
                continue
            if cons.is_empty():
                continue
            cons = cons.rename({k: v for k, v in {"代码": "code", "code": "code"}.items() if k in cons.columns})
            if "code" not in cons.columns:
                continue
            for code in cons["code"].cast(pl.Utf8).drop_nulls().to_list():
                mapping.setdefault(normalize_cn_symbol(code), industry)
        return mapping
