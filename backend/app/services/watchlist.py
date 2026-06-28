"""自选股服务(§6.1)。

存储:`data/user_data/watchlist.parquet`,字段 symbol + added_at + note。
"""
from __future__ import annotations

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import polars as pl

from app.config import settings
from app.tickflow.capabilities import Cap, CapabilitySet
from app.tickflow.client import get_client

logger = logging.getLogger(__name__)


def _path() -> Path:
    p = settings.data_dir / "user_data" / "watchlist.parquet"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _groups_path() -> Path:
    p = settings.data_dir / "user_data" / "watchlist_groups.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


def _normalize_symbol(value: object) -> str:
    return str(value or "").strip().upper()


def _empty_group_store() -> dict:
    return {"groups": [], "memberships": {}}


def _load_group_store() -> dict:
    p = _groups_path()
    if not p.exists():
        return _empty_group_store()
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("watchlist_groups.json malformed: %s", e)
        return _empty_group_store()
    groups = data.get("groups") if isinstance(data, dict) else []
    memberships = data.get("memberships") if isinstance(data, dict) else {}
    if not isinstance(groups, list):
        groups = []
    if not isinstance(memberships, dict):
        memberships = {}
    normalized_memberships: dict[str, list[str]] = {}
    group_ids = {str(g.get("id")) for g in groups if isinstance(g, dict) and g.get("id")}
    for raw_symbol, raw_group_ids in memberships.items():
        symbol = _normalize_symbol(raw_symbol)
        if not symbol or not isinstance(raw_group_ids, list):
            continue
        ids = [str(gid) for gid in raw_group_ids if str(gid) in group_ids]
        if ids:
            normalized_memberships[symbol] = sorted(set(ids))
    normalized_groups = []
    for group in groups:
        if not isinstance(group, dict) or not group.get("id") or not group.get("name"):
            continue
        normalized_groups.append({
            "id": str(group["id"]),
            "name": str(group["name"]),
            "kind": "custom",
            "description": str(group.get("description") or ""),
            "color": group.get("color"),
            "created_at": str(group.get("created_at") or _now()),
            "updated_at": str(group.get("updated_at") or group.get("created_at") or _now()),
        })
    return {"groups": normalized_groups, "memberships": normalized_memberships}


def _save_group_store(store: dict) -> dict:
    p = _groups_path()
    tmp = p.with_name(f"{p.name}.tmp")
    tmp.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)
    return store


def list_symbols() -> list[dict]:
    p = _path()
    if not p.exists():
        return []
    df = pl.read_parquet(p)
    if df.is_empty():
        return []
    return df.to_dicts()


def add(symbol: str, note: str = "") -> list[dict]:
    return add_many([symbol], note)


def add_many(symbols: list[str], note: str = "") -> list[dict]:
    p = _path()
    normalized: list[str] = []
    seen: set[str] = set()
    for symbol in symbols:
        value = _normalize_symbol(symbol)
        if value and value not in seen:
            seen.add(value)
            normalized.append(value)
    if not normalized:
        return list_symbols()

    if p.exists():
        df = pl.read_parquet(p)
        if "symbol" in df.columns:
            df = df.filter(~pl.col("symbol").is_in(normalized))
    else:
        df = pl.DataFrame(schema={"symbol": pl.Utf8, "added_at": pl.Utf8, "note": pl.Utf8})

    now = datetime.utcnow().isoformat(timespec="seconds")
    new_row = pl.DataFrame({
        "symbol": normalized,
        "added_at": [now] * len(normalized),
        "note": [note] * len(normalized),
    })
    out = pl.concat([new_row, df], how="diagonal_relaxed")
    out.write_parquet(p)
    return out.to_dicts()


def remove(symbol: str) -> list[dict]:
    p = _path()
    if not p.exists():
        return []
    df = pl.read_parquet(p)
    df = df.filter(pl.col("symbol") != symbol)
    df.write_parquet(p)
    return df.to_dicts()


def clear() -> int:
    """清空自选列表。返回移除的数量。"""
    p = _path()
    if not p.exists():
        return 0
    df = pl.read_parquet(p)
    count = df.height
    if count > 0:
        pl.DataFrame(schema={"symbol": pl.Utf8, "added_at": pl.Utf8, "note": pl.Utf8}).write_parquet(p)
    return count


def list_groups() -> dict:
    store = _load_group_store()
    counts = {group["id"]: 0 for group in store["groups"]}
    for group_ids in store["memberships"].values():
        for group_id in group_ids:
            if group_id in counts:
                counts[group_id] += 1
    groups = [{**group, "count": counts.get(group["id"], 0)} for group in store["groups"]]
    return {"groups": groups, "memberships": store["memberships"]}


def create_group(name: str, description: str = "", color: str | None = None) -> dict:
    store = _load_group_store()
    name = name.strip()
    if not name:
        raise ValueError("group name is required")
    group = {
        "id": f"wg_{uuid4().hex[:10]}",
        "name": name,
        "kind": "custom",
        "description": description.strip(),
        "color": color,
        "created_at": _now(),
        "updated_at": _now(),
    }
    store["groups"].append(group)
    _save_group_store(store)
    return group


def update_group(group_id: str, updates: dict) -> dict | None:
    store = _load_group_store()
    for group in store["groups"]:
        if group["id"] == group_id:
            if "name" in updates:
                name = str(updates["name"] or "").strip()
                if not name:
                    raise ValueError("group name is required")
                group["name"] = name
            if "description" in updates:
                group["description"] = str(updates["description"] or "").strip()
            if "color" in updates:
                group["color"] = updates.get("color")
            group["updated_at"] = _now()
            _save_group_store(store)
            return group
    return None


def delete_group(group_id: str) -> int:
    store = _load_group_store()
    before = len(store["groups"])
    store["groups"] = [g for g in store["groups"] if g["id"] != group_id]
    removed = before - len(store["groups"])
    if removed:
        memberships = {}
        for symbol, group_ids in store["memberships"].items():
            next_ids = [gid for gid in group_ids if gid != group_id]
            if next_ids:
                memberships[symbol] = next_ids
        store["memberships"] = memberships
        _save_group_store(store)
    return removed


def set_symbol_groups(symbol: str, group_ids: list[str]) -> dict:
    store = _load_group_store()
    symbol = _normalize_symbol(symbol)
    valid_group_ids = {group["id"] for group in store["groups"]}
    selected = sorted({gid for gid in group_ids if gid in valid_group_ids})
    if selected:
        store["memberships"][symbol] = selected
    else:
        store["memberships"].pop(symbol, None)
    _save_group_store(store)
    return {"symbol": symbol, "group_ids": selected}


def _exchange_group_id(symbol: str) -> str:
    suffix = symbol.rsplit(".", 1)[-1].upper() if "." in symbol else "UNKNOWN"
    return f"exchange:{suffix}"


SOURCE_GROUP_LABELS = {
    "manual": "手动添加",
    "strategy": "策略命中",
    "monitor": "监控规则",
    "alert": "最近告警",
    "watchlist": "观察池",
    "monitor_rules": "监控规则",
    "strategy_tracking": "策略跟踪",
    "recent_alerts": "最近告警",
    "manual_include": "手动追加",
}


def _source_from_note(note: object) -> str:
    text = str(note or "").strip().lower()
    if not text:
        return "manual"
    if "strategy" in text or "策略" in text:
        return "strategy"
    if "monitor" in text or "rule" in text or "监控" in text:
        return "monitor"
    if "alert" in text or "告警" in text:
        return "alert"
    return "manual"


def _append_source_group(auto_groups: dict[str, dict], source: str, symbols: set[str]) -> None:
    if not symbols:
        return
    label = SOURCE_GROUP_LABELS.get(source)
    if not label:
        return
    group_id = f"source:{source}"
    item = auto_groups.setdefault(group_id, {
        "id": group_id,
        "name": label,
        "kind": "auto",
        "source": "source",
        "symbols": [],
    })
    item["symbols"] = sorted(set(item["symbols"]) | symbols)


def _split_dimension_value(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list | tuple | set):
        raw_values = [str(v or "").strip() for v in value]
    else:
        raw_values = re.split(r"[,;\uFF0C\uFF1B/\u3001|]+", str(value or ""))
    out: list[str] = []
    seen: set[str] = set()
    for raw in raw_values:
        item = raw.strip()
        if not item or item.lower() in {"none", "nan", "null", "-"}:
            continue
        item = item[:80]
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _dimension_kind(text: str) -> str | None:
    lowered = text.lower()
    if any(token in lowered for token in ("concept", "theme")) or "概念" in text or "题材" in text:
        return "concept"
    if (
        any(token in lowered for token in ("industry", "sector"))
        or "行业" in text
        or "板块" in text
    ):
        return "industry"
    return None


def _is_dimension_field(field) -> str | None:
    name = str(getattr(field, "name", "") or "")
    label = str(getattr(field, "label", "") or "")
    normalized = name.strip().lower()
    if normalized in {"symbol", "code", "name", "股票代码", "股票简称", "名称"}:
        return None
    return _dimension_kind(f"{name} {label}")


def _latest_ext_dataframe(config, data_dir: Path) -> pl.DataFrame:
    cfg_dir = data_dir / "ext_data" / config.id
    if config.mode == "snapshot":
        path = cfg_dir / "part.parquet"
        return pl.read_parquet(path) if path.exists() else pl.DataFrame()
    base = cfg_dir / "timeseries"
    if not base.exists():
        return pl.DataFrame()
    partitions = sorted(
        d for d in base.iterdir()
        if d.is_dir() and d.name.startswith("date=") and (d / "part.parquet").exists()
    )
    if not partitions:
        return pl.DataFrame()
    return pl.read_parquet(partitions[-1] / "part.parquet")


def _add_dimension_group(
    auto_groups: dict[str, dict],
    *,
    kind: str,
    value: str,
    symbol: str,
    source: str,
) -> None:
    label = "概念" if kind == "concept" else "行业"
    group_id = f"{kind}:{value}"
    item = auto_groups.setdefault(group_id, {
        "id": group_id,
        "name": f"{label} · {value}",
        "kind": "auto",
        "source": kind,
        "symbols": [],
    })
    item["symbols"].append(symbol)


def _append_dimension_groups(auto_groups: dict[str, dict], all_symbols: list[str]) -> None:
    if not all_symbols:
        return
    symbol_set = set(all_symbols)
    data_dir = settings.data_dir

    inst_path = data_dir / "instruments" / "instruments.parquet"
    if inst_path.exists():
        try:
            inst = pl.read_parquet(inst_path)
            dimension_cols = [
                col for col in inst.columns
                if col != "symbol" and _dimension_kind(col)
            ]
            if "industry" in inst.columns and "industry" not in dimension_cols:
                dimension_cols.append("industry")
            if dimension_cols and "symbol" in inst.columns:
                for row in inst.select(["symbol", *dimension_cols]).iter_rows(named=True):
                    symbol = _normalize_symbol(row.get("symbol"))
                    if symbol not in symbol_set:
                        continue
                    for col in dimension_cols:
                        kind = _dimension_kind(col) or "industry"
                        for value in _split_dimension_value(row.get(col)):
                            _add_dimension_group(auto_groups, kind=kind, value=value, symbol=symbol, source="instruments")
        except Exception as e:
            logger.warning("watchlist auto dimension groups from instruments failed: %s", e)

    try:
        from app.services.ext_data import ExtConfigStore
        configs = ExtConfigStore(data_dir).load_all()
    except Exception as e:
        logger.warning("watchlist ext config scan failed: %s", e)
        return

    for config in configs:
        fields = [
            field for field in config.fields
            if _is_dimension_field(field)
        ]
        if not fields:
            continue
        try:
            df = _latest_ext_dataframe(config, data_dir)
        except Exception as e:
            logger.warning("watchlist ext dimension read failed: config=%s error=%s", config.id, e)
            continue
        if df.is_empty() or "symbol" not in df.columns:
            continue
        field_names = [field.name for field in fields if field.name in df.columns]
        if not field_names:
            continue
        for row in df.select(["symbol", *field_names]).iter_rows(named=True):
            symbol = _normalize_symbol(row.get("symbol"))
            if symbol not in symbol_set:
                continue
            for field in fields:
                if field.name not in row:
                    continue
                kind = _is_dimension_field(field)
                if not kind:
                    continue
                for value in _split_dimension_value(row.get(field.name)):
                    _add_dimension_group(auto_groups, kind=kind, value=value, symbol=symbol, source=config.id)


def build_group_preview(
    symbols: list[str] | None = None,
    *,
    by_source: dict[str, list[str]] | None = None,
) -> dict:
    store = _load_group_store()
    rows = list_symbols()
    raw_symbols = [r["symbol"] for r in rows] if symbols is None else symbols
    all_symbols = sorted({_normalize_symbol(s) for s in raw_symbols if _normalize_symbol(s)})
    symbol_set = set(all_symbols)
    custom_groups = []
    for group in store["groups"]:
        members = sorted([
            symbol
            for symbol in all_symbols
            if group["id"] in store["memberships"].get(symbol, [])
        ])
        custom_groups.append({**group, "symbols": members, "count": len(members)})

    auto_groups: dict[str, dict] = {}
    for symbol in all_symbols:
        group_id = _exchange_group_id(symbol)
        suffix = group_id.split(":", 1)[1]
        item = auto_groups.setdefault(group_id, {
            "id": group_id,
            "name": f"{suffix} 市场",
            "kind": "auto",
            "source": "exchange",
            "symbols": [],
        })
        item["symbols"].append(symbol)

    source_symbols_by_note: dict[str, set[str]] = {}
    for row in rows:
        symbol = _normalize_symbol(row.get("symbol"))
        if symbol not in symbol_set:
            continue
        source = _source_from_note(row.get("note"))
        source_symbols_by_note.setdefault(source, set()).add(symbol)
    for source, source_symbols in source_symbols_by_note.items():
        _append_source_group(auto_groups, source, source_symbols)

    for source, values in (by_source or {}).items():
        source_symbols = {_normalize_symbol(v) for v in values if _normalize_symbol(v)}
        if all_symbols:
            source_symbols = source_symbols & symbol_set
        _append_source_group(auto_groups, source, source_symbols)

    _append_dimension_groups(auto_groups, all_symbols)

    auto = []
    for group in auto_groups.values():
        group["symbols"] = sorted(set(group["symbols"]))
        group["count"] = len(group["symbols"])
        if group["count"] > 0:
            auto.append(group)
    auto.sort(key=lambda g: (g["source"], g["name"]))
    return {
        "mode": "all",
        "symbols": all_symbols,
        "custom": custom_groups,
        "auto": auto,
        "memberships": store["memberships"],
    }


def symbols_for_groups(group_ids: list[str], *, by_source: dict[str, list[str]] | None = None) -> list[str]:
    preview = build_group_preview(by_source=by_source)
    selected = set(group_ids)
    out: set[str] = set()
    for group in preview["custom"] + preview["auto"]:
        if group["id"] in selected:
            out.update(group["symbols"])
    return sorted(out)


def fetch_quotes(symbols: list[str], capset: CapabilitySet, timeout_s: float = 8.0) -> list[dict]:
    """拉取实时行情。

    优先用 quote.batch;否则降级为 quote.by_symbol 单股请求。
    timeout_s: 单批次请求超时(秒), 防止 API 卡死阻塞整个请求。
    """
    if not symbols:
        return []

    tf = get_client()
    quotes: list[dict] = []

    # 走 batch
    batch_size = 5
    if capset.has(Cap.QUOTE_BATCH):
        lim = capset.limits(Cap.QUOTE_BATCH)
        batch_size = lim.batch if lim and lim.batch else 50
    elif capset.has(Cap.QUOTE_BY_SYMBOL):
        lim = capset.limits(Cap.QUOTE_BY_SYMBOL)
        batch_size = lim.batch if lim and lim.batch else 5
    else:
        # 无任何实时行情能力(none/free 档走 free-api 服务器,不提供实时行情)
        # 提前返回空,避免发起注定失败的请求
        return []

    chunks = [symbols[i:i + batch_size] for i in range(0, len(symbols), batch_size)]

    # 用线程池为每个批次加超时保护
    pool = ThreadPoolExecutor(max_workers=1)
    for chunk in chunks:
        try:
            future = pool.submit(tf.quotes.get, symbols=chunk, as_dataframe=True)
            raw = future.result(timeout=timeout_s)
            if raw is None or len(raw) == 0:
                continue
            df = pl.from_pandas(raw)
            rename_map = {
                "last_price": "price",
                "ext.change_pct": "pct",
                "ext.name": "name",
            }
            df = df.rename({k: v for k, v in rename_map.items() if k in df.columns})
            quotes.extend(df.to_dicts())
        except FuturesTimeout:
            logger.warning("quote fetch timeout (%.1fs) for %d symbols", timeout_s, len(chunk))
            break  # 超时后不再尝试后续批次
        except Exception as e:
            logger.warning("quote fetch failed for %d symbols: %s", len(chunk), e)
    pool.shutdown(wait=False)

    return quotes
