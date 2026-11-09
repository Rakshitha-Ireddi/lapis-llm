"""Memory admission: decide whether a model may start on a node, and say why not."""

from __future__ import annotations

from dataclasses import dataclass

from .domain import RuntimeKind, Telemetry


@dataclass(frozen=True)
class Admission:
    ok: bool
    reason: str
    #: Free memory left over after the model starts (only meaningful when ``ok``).
    headroom_gib: float = 0.0
    gpu_index: int | None = None


def check(
    budget_gib: float,
    runtime: RuntimeKind,
    node_runtimes: list[RuntimeKind],
    telemetry: Telemetry | None,
    reserve_gib: float,
) -> Admission:
    """Check whether a model with ``budget_gib`` fits on a node.

    * Unified-memory machines (Apple Silicon, DGX Spark) and CPU-less telemetry
      are checked against the whole memory pool.
    * Discrete-GPU machines are checked per GPU: the model must fit on a single
      card, after the reserve, because layers are not split across cards.
    """
    if runtime not in node_runtimes:
        offered = ", ".join(r.value for r in node_runtimes) or "none"
        return Admission(False, f"node does not offer runtime {runtime.value} (offers {offered})")
    if telemetry is None:
        return Admission(False, "node has not reported telemetry yet")

    if telemetry.unified_memory or not telemetry.gpus:
        free = telemetry.memory_free_gib - reserve_gib
        if budget_gib <= free:
            return Admission(
                True,
                f"fits: needs {budget_gib:.2f} GiB, {free:.2f} GiB free "
                f"after {reserve_gib:.2f} GiB reserve",
                headroom_gib=round(free - budget_gib, 2),
            )
        return Admission(
            False,
            f"needs {budget_gib:.2f} GiB but only {max(free, 0):.2f} GiB is free "
            f"after the {reserve_gib:.2f} GiB reserve",
        )

    best = max(telemetry.gpus, key=lambda g: g.memory_free_gib)
    free = best.memory_free_gib - reserve_gib
    if budget_gib <= free:
        return Admission(
            True,
            f"fits on GPU {best.index} ({best.name}): needs {budget_gib:.2f} GiB, "
            f"{free:.2f} GiB free after {reserve_gib:.2f} GiB reserve",
            headroom_gib=round(free - budget_gib, 2),
            gpu_index=best.index,
        )
    return Admission(
        False,
        f"needs {budget_gib:.2f} GiB but the roomiest GPU ({best.name}) has "
        f"{max(free, 0):.2f} GiB free after the {reserve_gib:.2f} GiB reserve",
    )
