"""全局配置 — 从环境变量 / .env 读取。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# ── 运行环境检测 ──────────────────────────────────────────
# PyInstaller 打包后: __file__ 指向临时解压目录 _MEIPASS, 不能作为路径基准。
# 此时:
#   - 只读资源 (tiers.yaml / 前端 dist) 放在 _MEIPASS 内
#   - 可写用户数据 (data_dir) 放在可执行文件旁的用户目录
# 非 frozen 模式 (开发/Docker): 保持原有 __file__ 推导, 行为完全不变。
_IS_FROZEN = getattr(sys, "frozen", False)


def _user_data_root() -> Path:
    """桌面版用户数据根目录 (跨平台持久可写)。

    Windows: %LOCALAPPDATA%/TickFlowStockPanel/TickFlowStockPanel
    macOS:   ~/Library/Application Support/TickFlowStockPanel
    Linux:   ~/.local/share/TickFlowStockPanel

    注意: platformdirs 已含应用名, 切勿再拼一层。
    """
    try:
        from platformdirs import user_data_dir

        return Path(user_data_dir("TickFlowStockPanel"))
    except Exception:  # noqa: BLE001
        # platformdirs 不可用时兜底: 可执行文件旁的 data/
        return Path(sys.executable).resolve().parent / "data"


def _resource_root() -> Path:
    """只读资源根目录。

    frozen: PyInstaller 解压目录 (_MEIPASS)
    非 frozen: 项目根目录 (源码树)
    """
    if _IS_FROZEN:
        # sys._MEIPASS 是 PyInstaller 注入的解压根
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return Path(__file__).resolve().parent.parent.parent


def _project_root() -> Path:
    """项目根目录 (非 frozen 用)。"""
    return Path(__file__).resolve().parent.parent.parent


_PROJECT_ROOT = _project_root()
_RESOURCE_ROOT = _resource_root()


def _load_user_settings(data_dir: Path) -> dict:
    """Read user-overridden settings without importing secrets_store.

    config.py is imported by secrets_store, so this small reader keeps startup
    provider overrides independent from that module.
    """
    p = data_dir / "user_data" / "secrets.json"
    try:
        if not p.exists():
            return {}
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _apply_user_settings(settings_obj: "Settings") -> None:
    """Apply safe user settings that should override .env on next startup."""
    data = _load_user_settings(settings_obj.data_dir)
    provider = str(data.get("data_provider") or "").strip().lower()
    if provider in {"tickflow", "akshare"}:
        settings_obj.data_provider = provider


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_RESOURCE_ROOT / ".env") if not _IS_FROZEN else ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # TickFlow
    tickflow_api_key: str = Field(default="", description="留空启用 free 模式")

    # Data provider
    data_provider: str = Field(default="tickflow", description="tickflow / akshare")
    fallback_provider: str = Field(default="baostock", description="备用免费数据源标识")
    akshare_initial_years: int = Field(default=3, ge=1, le=10)
    akshare_timeout_seconds: int = Field(default=20, ge=5, le=120)
    akshare_retry_count: int = Field(default=3, ge=0, le=10)
    akshare_max_workers: int = Field(default=8, ge=1, le=32)
    akshare_write_batch_size: int = Field(default=64, ge=1, le=512)

    # AI
    ai_provider: str = "openai_compat"
    ai_base_url: str = "https://api.alysc.top"
    ai_api_key: str = ""
    ai_model: str = "gpt-5.5"
    ai_daily_token_budget: int = 5_000_000

    # Server
    host: str = "0.0.0.0"
    port: int = 3018
    log_level: str = "INFO"
    backtest_range_guard: bool = False

    # Data — frozen: 用户数据目录; 非 frozen: 项目根目录的 data/ (可被 DATA_DIR 覆盖)
    data_dir: Path = _user_data_root() if _IS_FROZEN else (_PROJECT_ROOT / "data")

    # tiers.yaml 路径 — frozen: 资源目录内; 非 frozen: 项目根目录
    tiers_yaml: Path = _RESOURCE_ROOT / "tiers.yaml" if _IS_FROZEN else _PROJECT_ROOT / "tiers.yaml"

    # 静态文件(前端 dist) — frozen: 资源目录的 static/; 非 frozen: frontend/dist
    static_dir: Path = _RESOURCE_ROOT / "static" if _IS_FROZEN else (_PROJECT_ROOT / "frontend" / "dist")

    @model_validator(mode="after")
    def _resolve_paths(self) -> Settings:
        """确保 data_dir 是绝对路径（环境变量传入的相对路径基于项目根目录解析）。"""
        if not self.data_dir.is_absolute():
            # 相对路径基于项目根目录解析，而非 CWD
            self.data_dir = (_PROJECT_ROOT / self.data_dir).resolve()
        return self

    @property
    def use_free_mode(self) -> bool:
        """是否走 Free 模式。优先看 secrets.json,其次看 .env。"""
        from app import secrets_store
        return not secrets_store.get_tickflow_key()

    @property
    def provider_is_akshare(self) -> bool:
        return self.data_provider.strip().lower() == "akshare"


settings = Settings()
_apply_user_settings(settings)
