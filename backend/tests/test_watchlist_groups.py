from types import SimpleNamespace

import polars as pl

from app.api.settings import (
    FocusUniverseConfigIn,
    get_focus_universe_preferences,
    update_focus_universe_preferences,
)
from app.config import settings
from app.services import focus_universe, preferences, watchlist
from app.services.ext_data import ExtConfig, ExtConfigStore, ExtField


def _only_watchlist_sources() -> dict[str, bool]:
    return {
        "watchlist": True,
        "monitor_rules": False,
        "strategy_tracking": False,
        "recent_alerts": False,
        "local_fallback": False,
        "demo": False,
    }


def test_focus_universe_uses_all_watchlist_without_group_file(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    watchlist.add("600000.SH")
    watchlist.add("000001.SZ")
    preferences.set_focus_universe_config({"sources": _only_watchlist_sources()})

    detail = focus_universe.resolve_focus_universe_detail(tmp_path)

    assert detail["symbols"] == ["000001.SZ", "600000.SH"]
    assert detail["watchlist_groups"]["symbols"] == ["000001.SZ", "600000.SH"]


def test_focus_universe_filters_watchlist_by_custom_group(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    watchlist.add("600000.SH")
    watchlist.add("000001.SZ")
    group = watchlist.create_group("核心观察")
    watchlist.set_symbol_groups("600000.SH", [group["id"]])
    preferences.set_focus_universe_config({
        "sources": _only_watchlist_sources(),
        "watchlist_group_mode": "selected",
        "watchlist_group_ids": [group["id"]],
    })

    detail = focus_universe.resolve_focus_universe_detail(tmp_path)

    assert detail["symbols"] == ["600000.SH"]
    custom = {item["id"]: item for item in detail["watchlist_groups"]["custom"]}
    assert custom[group["id"]]["count"] == 1


def test_focus_universe_filters_watchlist_by_auto_exchange_group(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    watchlist.add("600000.SH")
    watchlist.add("000001.SZ")
    preferences.set_focus_universe_config({
        "sources": _only_watchlist_sources(),
        "watchlist_group_mode": "selected",
        "watchlist_group_ids": ["exchange:SZ"],
    })

    detail = focus_universe.resolve_focus_universe_detail(tmp_path)

    assert detail["symbols"] == ["000001.SZ"]
    auto = {item["id"]: item for item in detail["watchlist_groups"]["auto"]}
    assert auto["exchange:SZ"]["count"] == 1


def test_watchlist_auto_groups_include_note_sources(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    watchlist.add("600000.SH")
    watchlist.add("000001.SZ", note="strategy:limit_up")
    watchlist.add("300001.SZ", note="monitor rule")
    watchlist.add("830001.BJ", note="recent_alert")

    preview = watchlist.build_group_preview()
    auto = {item["id"]: item for item in preview["auto"]}

    assert auto["source:manual"]["symbols"] == ["600000.SH"]
    assert auto["source:strategy"]["symbols"] == ["000001.SZ"]
    assert auto["source:monitor"]["symbols"] == ["300001.SZ"]
    assert auto["source:alert"]["symbols"] == ["830001.BJ"]


def test_focus_universe_save_syncs_range_to_watchlist(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                repo=SimpleNamespace(store=SimpleNamespace(data_dir=tmp_path)),
            ),
        ),
    )

    update_focus_universe_preferences(
        FocusUniverseConfigIn(
            sources=_only_watchlist_sources(),
            include_symbols=["000001.SZ", "600000.SH"],
        ),
        request,
    )

    assert [row["symbol"] for row in watchlist.list_symbols()] == ["000001.SZ", "600000.SH"]


def test_focus_universe_get_migrates_existing_manual_range_to_watchlist(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                repo=SimpleNamespace(store=SimpleNamespace(data_dir=tmp_path)),
            ),
        ),
    )
    preferences.set_focus_universe_config({
        "sources": _only_watchlist_sources(),
        "include_symbols": ["000001.SZ", "600000.SH"],
    })

    get_focus_universe_preferences(request)

    assert [row["symbol"] for row in watchlist.list_symbols()] == ["000001.SZ", "600000.SH"]


def test_focus_universe_save_does_not_persist_local_fallback(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    inst_dir = tmp_path / "instruments"
    inst_dir.mkdir(parents=True)
    pl.DataFrame({
        "symbol": ["000001.SZ", "600000.SH"],
        "name": ["平安银行", "浦发银行"],
    }).write_parquet(inst_dir / "instruments.parquet")
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                repo=SimpleNamespace(store=SimpleNamespace(data_dir=tmp_path)),
            ),
        ),
    )

    update_focus_universe_preferences(
        FocusUniverseConfigIn(
            sources={
                "watchlist": False,
                "monitor_rules": False,
                "strategy_tracking": False,
                "recent_alerts": False,
                "local_fallback": True,
                "demo": False,
            },
            local_fallback_limit=2,
        ),
        request,
    )

    assert watchlist.list_symbols() == []


def test_watchlist_auto_groups_include_concept_and_industry(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    inst_dir = tmp_path / "instruments"
    inst_dir.mkdir(parents=True)
    pl.DataFrame({
        "symbol": ["000001.SZ", "600000.SH"],
        "name": ["平安银行", "浦发银行"],
        "industry": ["银行", "银行"],
        "概念": ["低空经济,金融科技", "金融科技"],
    }).write_parquet(inst_dir / "instruments.parquet")
    watchlist.add_many(["000001.SZ", "600000.SH"])

    preview = watchlist.build_group_preview()
    auto = {item["id"]: item for item in preview["auto"]}

    assert auto["industry:银行"]["count"] == 2
    assert auto["concept:金融科技"]["count"] == 2
    assert auto["concept:低空经济"]["symbols"] == ["000001.SZ"]


def test_watchlist_auto_groups_ignore_identity_fields_in_concept_ext_config(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    ExtConfigStore(tmp_path).upsert(ExtConfig(
        id="ext_gn",
        label="扩展概念",
        mode="snapshot",
        fields=[
            ExtField("symbol"),
            ExtField("code"),
            ExtField("股票简称"),
            ExtField("所属概念"),
        ],
    ))
    ext_dir = tmp_path / "ext_data" / "ext_gn"
    ext_dir.mkdir(parents=True, exist_ok=True)
    pl.DataFrame({
        "symbol": ["000001.SZ"],
        "code": ["000001"],
        "股票简称": ["平安银行"],
        "所属概念": ["金融科技"],
    }).write_parquet(ext_dir / "part.parquet")
    watchlist.add("000001.SZ")

    preview = watchlist.build_group_preview()
    auto = {item["id"]: item for item in preview["auto"]}

    assert "concept:000001.SZ" not in auto
    assert "concept:000001" not in auto
    assert "concept:平安银行" not in auto
    assert auto["concept:金融科技"]["symbols"] == ["000001.SZ"]
