"""Provider stage support matrix.

The matrix is the backend-owned source for provider/stage semantics used by
pipeline orchestration and API responses.
"""
from __future__ import annotations

from typing import Literal, TypedDict

from app.datasource.base import ProviderName, current_provider_name

ProviderStageStatus = Literal["supported", "unsupported", "manual_only", "disabled", "capability_required"]


class ProviderStageInfo(TypedDict, total=False):
    status: ProviderStageStatus
    label: str
    message: str
    capability: str


class ProviderStage(TypedDict):
    id: str
    label: str
    tickflow: ProviderStageInfo
    akshare: ProviderStageInfo


_STAGES: tuple[ProviderStage, ...] = (
    {
        "id": "capability_detection",
        "label": "能力探测",
        "tickflow": {"status": "supported", "label": "TickFlow 能力探测"},
        "akshare": {"status": "supported", "label": "AkShare 静态日线能力"},
    },
    {
        "id": "startup_auto_network_sync",
        "label": "启动自动网络同步",
        "tickflow": {"status": "supported", "label": "按调度自动同步"},
        "akshare": {"status": "manual_only", "label": "手动同步", "message": "AkShare 网络同步仅手动触发"},
    },
    {
        "id": "manual_after_market_pipeline",
        "label": "盘后手动管道",
        "tickflow": {"status": "supported", "label": "支持"},
        "akshare": {"status": "supported", "label": "支持"},
    },
    {
        "id": "focus_scope_sync",
        "label": "关注范围同步",
        "tickflow": {"status": "supported", "label": "支持"},
        "akshare": {"status": "supported", "label": "支持"},
    },
    {
        "id": "market_sync",
        "label": "全市场同步",
        "tickflow": {"status": "supported", "label": "支持"},
        "akshare": {"status": "supported", "label": "支持"},
    },
    {
        "id": "realtime_quotes",
        "label": "实时行情",
        "tickflow": {"status": "capability_required", "label": "需 quote realtime capability", "capability": "quote.batch"},
        "akshare": {"status": "unsupported", "label": "不支持", "message": "AkShare 阶段仅盘后日线"},
    },
    {
        "id": "minute_k",
        "label": "分钟 K",
        "tickflow": {"status": "capability_required", "label": "需分钟 K capability", "capability": "kline.minute.batch"},
        "akshare": {"status": "unsupported", "label": "不支持", "message": "AkShare 阶段不提供分钟 K"},
    },
    {
        "id": "depth5",
        "label": "五档盘口",
        "tickflow": {"status": "capability_required", "label": "需五档 capability", "capability": "depth5.batch"},
        "akshare": {"status": "unsupported", "label": "不支持", "message": "AkShare 阶段不提供五档盘口"},
    },
    {
        "id": "financial",
        "label": "财务数据",
        "tickflow": {"status": "capability_required", "label": "需财务 capability", "capability": "financial"},
        "akshare": {"status": "unsupported", "label": "不支持", "message": "AkShare 阶段暂不接入财务表"},
    },
    {
        "id": "adj_factor",
        "label": "复权因子",
        "tickflow": {"status": "capability_required", "label": "需复权因子 capability", "capability": "adj_factor"},
        "akshare": {"status": "unsupported", "label": "不支持", "message": "AkShare 日线直接使用前复权口径"},
    },
    {
        "id": "index_daily_k",
        "label": "指数日 K",
        "tickflow": {"status": "supported", "label": "支持"},
        "akshare": {"status": "supported", "label": "支持"},
    },
)


def provider_stage_matrix(provider: str | None = None) -> list[dict]:
    selected = current_provider_name(provider)
    return [
        {
            "id": stage["id"],
            "label": stage["label"],
            "status": stage[selected]["status"],
            "provider_label": stage[selected]["label"],
            "message": stage[selected].get("message"),
            "capability": stage[selected].get("capability"),
        }
        for stage in _STAGES
    ]


def stage_info(stage_id: str, provider: ProviderName | str | None = None) -> ProviderStageInfo | None:
    selected = current_provider_name(provider)
    for stage in _STAGES:
        if stage["id"] == stage_id:
            return stage[selected]
    return None


def unsupported_pipeline_stages(provider: ProviderName | str | None = None) -> list[str]:
    """Return pipeline result skipped_stage ids implied by provider support."""
    selected = current_provider_name(provider)
    if selected == "akshare":
        return ["sync_adj", "sync_minute", "depth5", "financials"]
    return []
