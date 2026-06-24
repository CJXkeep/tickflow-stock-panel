"""Shared data-source contracts and normalization helpers."""
from __future__ import annotations

from typing import Literal

ProviderName = Literal["tickflow", "akshare"]


def current_provider_name(value: str | None) -> ProviderName:
    provider = (value or "tickflow").strip().lower()
    if provider == "akshare":
        return "akshare"
    return "tickflow"


def provider_label(provider: str) -> str:
    return "AkShare" if current_provider_name(provider) == "akshare" else "TickFlow"


def normalize_cn_symbol(code: str) -> str:
    """Normalize common A-share code forms to 000001.SZ / 600000.SH / 8xxxxx.BJ."""
    raw = str(code or "").strip().upper()
    if not raw:
        return raw

    if "." in raw:
        left, right = raw.split(".", 1)
        code_part = "".join(ch for ch in left if ch.isdigit())
        suffix = right[:2].upper()
        if code_part and suffix in {"SH", "SZ", "BJ"}:
            return f"{code_part.zfill(6)}.{suffix}"

    if raw.startswith(("SH", "SZ", "BJ")):
        prefix, digits = raw[:2], "".join(ch for ch in raw[2:] if ch.isdigit())
        if digits:
            suffix = {"SH": "SH", "SZ": "SZ", "BJ": "BJ"}[prefix]
            return f"{digits.zfill(6)}.{suffix}"

    digits = "".join(ch for ch in raw if ch.isdigit())
    if not digits:
        return raw
    digits = digits.zfill(6)
    if digits.startswith(("43", "83", "87", "88", "92")):
        return f"{digits}.BJ"
    if digits.startswith(("5", "6", "9")):
        return f"{digits}.SH"
    return f"{digits}.SZ"


def symbol_to_ak_code(symbol: str) -> str:
    """Return AkShare stock code without exchange suffix."""
    return normalize_cn_symbol(symbol).split(".", 1)[0]


def symbol_to_ak_index(symbol: str) -> str:
    """Return AkShare index code such as sh000001 / sz399001."""
    norm = normalize_cn_symbol(symbol)
    code, _, suffix = norm.partition(".")
    prefix = "sh" if suffix == "SH" else "bj" if suffix == "BJ" else "sz"
    return f"{prefix}{code}"

