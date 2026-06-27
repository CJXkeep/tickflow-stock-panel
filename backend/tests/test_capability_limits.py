import json

import pytest
from fastapi import HTTPException

from app.api.kline import _resolve_minute_history_days
from app.config import settings
from app.datasource.stage_matrix import provider_stage_matrix, unsupported_pipeline_stages
from app.services.depth_service import DepthService
from app.services.quote_service import QuoteService
from app.tickflow import policy
from app.tickflow.capabilities import Cap, CapabilityLimits, CapabilitySet


def test_capability_limits_round_trip_preserves_extended_fields():
    capset = CapabilitySet({
        Cap.QUOTE_BATCH: CapabilityLimits(
            rpm=120,
            batch=100,
            min_interval=2,
            max_interval=60,
            realtime_allowed=True,
        ),
        Cap.KLINE_MINUTE_BATCH: CapabilityLimits(
            rpm=30,
            batch=100,
            max_history_days=15,
        ),
    })

    parsed = policy._capset_from_json({"capabilities": capset.to_dict()})

    quote = parsed.require(Cap.QUOTE_BATCH)
    assert quote.rpm == 120
    assert quote.batch == 100
    assert quote.min_interval == 2
    assert quote.max_interval == 60
    assert quote.realtime_allowed is True

    minute = parsed.require(Cap.KLINE_MINUTE_BATCH)
    assert minute.max_history_days == 15


def test_akshare_capabilities_are_daily_only(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_provider", "akshare")
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    capset = policy.detect_capabilities(force=True)

    assert set(capset.all()) == {Cap.KLINE_DAILY_BY_SYMBOL, Cap.KLINE_DAILY_BATCH}
    assert not capset.has(Cap.QUOTE_BATCH)
    assert not capset.has(Cap.KLINE_MINUTE_BATCH)
    assert not capset.has(Cap.DEPTH5_BATCH)
    assert not capset.has(Cap.FINANCIAL)

    cached = json.loads((tmp_path / "capabilities.json").read_text(encoding="utf-8"))
    assert cached["label"] == "AkShare"


def test_quote_realtime_bounds_use_capability_limits(monkeypatch):
    monkeypatch.setattr(settings, "data_provider", "tickflow")
    capset = CapabilitySet({
        Cap.QUOTE_BATCH: CapabilityLimits(
            realtime_allowed=True,
            min_interval=2,
            max_interval=45,
        ),
    })

    assert QuoteService.is_realtime_allowed(capset) is True
    assert QuoteService.interval_bounds_for(capset) == (2.0, 45.0)


def test_depth_interval_bounds_use_capability_limits():
    capset = CapabilitySet({
        Cap.DEPTH5_BATCH: CapabilityLimits(min_interval=3, max_interval=300),
    })

    assert DepthService.interval_bounds_for(capset) == (3.0, 300.0)


def test_minute_history_uses_max_history_days():
    pro = CapabilitySet({
        Cap.KLINE_MINUTE_BATCH: CapabilityLimits(max_history_days=15),
    })
    expert = CapabilitySet({
        Cap.KLINE_MINUTE_BATCH: CapabilityLimits(max_history_days=180),
    })

    assert _resolve_minute_history_days(pro, 99, "day") == 15
    with pytest.raises(HTTPException) as exc:
        _resolve_minute_history_days(pro, 1, "month")
    assert exc.value.status_code == 403

    assert _resolve_minute_history_days(expert, 2, "month") == 60
    assert _resolve_minute_history_days(expert, 9, "month") == 180


def test_minute_history_rejects_missing_max_history_days():
    capset = CapabilitySet({
        Cap.KLINE_MINUTE_BATCH: CapabilityLimits(),
    })

    with pytest.raises(HTTPException) as exc:
        _resolve_minute_history_days(capset, 5, "day")

    assert exc.value.status_code == 403


def test_provider_stage_matrix_marks_akshare_enhanced_stages():
    stages = {item["id"]: item for item in provider_stage_matrix("akshare")}

    assert stages["realtime_quotes"]["status"] == "unsupported"
    assert stages["minute_k"]["status"] == "unsupported"
    assert stages["depth5"]["status"] == "unsupported"
    assert stages["financial"]["status"] == "unsupported"
    assert unsupported_pipeline_stages("akshare") == ["sync_adj", "sync_minute", "depth5", "financials"]
