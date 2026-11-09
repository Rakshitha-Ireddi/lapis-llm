"""Runtime configuration for the master, read from ``LAPIS_*`` environment variables."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path


def _bool(value: str | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    #: Where state.json and audit.jsonl live. ``None`` keeps state in memory.
    data_dir: Path | None = None
    #: Admin password for the console and admin API.
    admin_password: str = field(default_factory=lambda: secrets.token_urlsafe(12))
    #: Require an API key for /v1 and /metrics.
    require_api_key: bool = True
    #: Memory kept free on every node/GPU for the OS and desktop.
    memory_reserve_gib: float = 1.0
    #: A node that has not sent a heartbeat for this long is shown as offline.
    heartbeat_timeout_s: float = 30.0
    #: HMAC key for admin sessions. Random per process unless pinned.
    session_secret: str = field(default_factory=lambda: secrets.token_hex(32))
    #: Built web console to serve at ``/`` (``web/dist``).
    web_dir: Path | None = None
    #: Extra origins allowed to call the API from a browser.
    cors_origins: list[str] = field(default_factory=list)
    #: Approve every enrolment automatically. Only for the local demo fleet.
    auto_approve: bool = False
    #: True when the admin password was generated rather than configured.
    password_generated: bool = False

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Settings:
        env = dict(os.environ if env is None else env)
        password = env.get("LAPIS_ADMIN_PASSWORD", "")
        settings = cls(
            data_dir=Path(env["LAPIS_DATA_DIR"]) if env.get("LAPIS_DATA_DIR") else Path("data"),
            require_api_key=_bool(env.get("LAPIS_REQUIRE_API_KEY"), True),
            memory_reserve_gib=float(env.get("LAPIS_MEMORY_RESERVE_GIB", "1.0")),
            heartbeat_timeout_s=float(env.get("LAPIS_HEARTBEAT_TIMEOUT_S", "30")),
            web_dir=Path(env["LAPIS_WEB_DIR"]) if env.get("LAPIS_WEB_DIR") else None,
            cors_origins=[o.strip() for o in env.get("LAPIS_CORS_ORIGINS", "").split(",") if o],
            auto_approve=_bool(env.get("LAPIS_AUTO_APPROVE"), False),
        )
        if env.get("LAPIS_SESSION_SECRET"):
            settings.session_secret = env["LAPIS_SESSION_SECRET"]
        if password:
            settings.admin_password = password
        else:
            settings.password_generated = True
        return settings
