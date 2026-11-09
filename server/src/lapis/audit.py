"""Append-only audit log: who did what, to what, and when."""

from __future__ import annotations

import json
import time
from collections import deque
from pathlib import Path
from typing import Any


class AuditLog:
    def __init__(self, path: Path | None = None, maxlen: int = 500, clock=time.time) -> None:
        self.path = path
        self._clock = clock
        self._entries: deque[dict[str, Any]] = deque(maxlen=maxlen)
        if path and path.exists():
            for line in path.read_text(encoding="utf-8").splitlines()[-maxlen:]:
                if line.strip():
                    self._entries.append(json.loads(line))

    def record(self, actor: str, action: str, target: str = "", detail: str = "") -> dict[str, Any]:
        entry = {
            "at": self._clock(),
            "actor": actor,
            "action": action,
            "target": target,
            "detail": detail,
        }
        self._entries.append(entry)
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry) + "\n")
        return entry

    def recent(self, limit: int = 100) -> list[dict[str, Any]]:
        return list(reversed(self._entries))[:limit]
