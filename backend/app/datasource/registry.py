"""Data provider registry."""
from __future__ import annotations

from app.config import settings
from app.datasource.base import current_provider_name, provider_label


def current_provider() -> str:
    return current_provider_name(settings.data_provider)


def current_provider_label() -> str:
    return provider_label(current_provider())


def is_akshare() -> bool:
    return current_provider() == "akshare"

