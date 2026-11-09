"""Prometheus text exposition without the client library."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from typing import Any


def _labels(**labels: str) -> str:
    inner = ",".join(
        f'{k}="{str(v).replace(chr(92), chr(92) * 2).replace(chr(34), chr(92) + chr(34))}"'
        for k, v in labels.items()
    )
    return "{" + inner + "}"


class Metrics:
    def __init__(self) -> None:
        self.requests: Counter[tuple[str, str]] = Counter()
        self.tokens: Counter[str] = Counter()
        self.in_flight = 0

    @property
    def requests_total(self) -> int:
        return sum(self.requests.values())

    @property
    def tokens_total(self) -> int:
        return sum(self.tokens.values())

    def observe(self, model: str, status: int, tokens: int) -> None:
        self.requests[(model, str(status))] += 1
        if tokens:
            self.tokens[model] += tokens

    def render(
        self,
        nodes: Iterable[dict[str, Any]],
        models: Iterable[dict[str, Any]],
    ) -> str:
        lines = [
            "# HELP lapis_requests_total Inference requests proxied by the router.",
            "# TYPE lapis_requests_total counter",
        ]
        for (model, status), count in sorted(self.requests.items()):
            lines.append(f"lapis_requests_total{_labels(model=model, status=status)} {count}")
        lines += [
            "# HELP lapis_tokens_total Tokens reported by upstream runtimes.",
            "# TYPE lapis_tokens_total counter",
        ]
        for model, count in sorted(self.tokens.items()):
            lines.append(f"lapis_tokens_total{_labels(model=model)} {count}")
        lines += [
            "# HELP lapis_requests_in_flight Requests currently being proxied.",
            "# TYPE lapis_requests_in_flight gauge",
            f"lapis_requests_in_flight {self.in_flight}",
            "# HELP lapis_node_up Whether a node is online (1) or not (0).",
            "# TYPE lapis_node_up gauge",
        ]
        node_list = list(nodes)
        for node in node_list:
            up = 1 if node["state"] in ("online", "draining") else 0
            lines.append(f"lapis_node_up{_labels(node=node['name'])} {up}")
        lines += [
            "# HELP lapis_node_memory_free_gib Free accelerator memory per node.",
            "# TYPE lapis_node_memory_free_gib gauge",
        ]
        for node in node_list:
            tel = node.get("telemetry") or {}
            free = tel.get("memory_total_gib", 0) - tel.get("memory_used_gib", 0)
            lines.append(f"lapis_node_memory_free_gib{_labels(node=node['name'])} {free:.2f}")
        lines += [
            "# HELP lapis_model_running Whether a model is running (1) or not (0).",
            "# TYPE lapis_model_running gauge",
        ]
        for model in models:
            running = 1 if model["state"] == "running" else 0
            lines.append(f"lapis_model_running{_labels(model=model['spec']['name'])} {running}")
        return "\n".join(lines) + "\n"
