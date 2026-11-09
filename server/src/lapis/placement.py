"""Placement: pick the node a model should run on."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass

from . import admission
from .admission import Admission
from .domain import ModelSpec, Node, NodeState


@dataclass(frozen=True)
class Candidate:
    node: Node
    admission: Admission


def evaluate(
    spec: ModelSpec,
    nodes: Iterable[Node],
    state_of: Callable[[Node], NodeState],
    reserve_gib: float,
) -> list[Candidate]:
    """Run the admission check for ``spec`` against every node."""
    out: list[Candidate] = []
    for node in nodes:
        state = state_of(node)
        if state != NodeState.ONLINE:
            out.append(Candidate(node, Admission(False, f"node is {state.value}")))
            continue
        out.append(
            Candidate(
                node,
                admission.check(
                    spec.budget_gib, spec.runtime, node.runtimes, node.telemetry, reserve_gib
                ),
            )
        )
    return out


def choose(candidates: list[Candidate]) -> Candidate | None:
    """Best fit: the admissible node with the *least* headroom left over.

    Packing small models onto small machines keeps the big machines free for the
    big models, which is what a home fleet usually wants.
    """
    fitting = [c for c in candidates if c.admission.ok]
    if not fitting:
        return None
    return min(fitting, key=lambda c: (c.admission.headroom_gib, c.node.name))
