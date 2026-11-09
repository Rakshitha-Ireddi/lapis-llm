/** Admission + placement. Mirrors server/src/lapis/admission.py and placement.py. */

import type { NodeState, NodeView, RuntimeKind, Telemetry } from "./types";

export interface Admission {
  ok: boolean;
  reason: string;
  headroomGib: number;
  gpuIndex: number | null;
}

const f2 = (n: number) => n.toFixed(2);

export function check(
  budgetGib: number,
  runtime: RuntimeKind,
  nodeRuntimes: RuntimeKind[],
  telemetry: Telemetry | null,
  reserveGib: number,
): Admission {
  const no = (reason: string): Admission => ({ ok: false, reason, headroomGib: 0, gpuIndex: null });
  if (!nodeRuntimes.includes(runtime)) {
    return no(
      `node does not offer runtime ${runtime} (offers ${nodeRuntimes.join(", ") || "none"})`,
    );
  }
  if (!telemetry) return no("node has not reported telemetry yet");

  if (telemetry.unified_memory || telemetry.gpus.length === 0) {
    const free = Math.max(0, telemetry.memory_total_gib - telemetry.memory_used_gib) - reserveGib;
    if (budgetGib <= free) {
      return {
        ok: true,
        reason: `fits: needs ${f2(budgetGib)} GiB, ${f2(free)} GiB free after ${f2(reserveGib)} GiB reserve`,
        headroomGib: Math.round((free - budgetGib) * 100) / 100,
        gpuIndex: null,
      };
    }
    return no(
      `needs ${f2(budgetGib)} GiB but only ${f2(Math.max(free, 0))} GiB is free after the ${f2(reserveGib)} GiB reserve`,
    );
  }

  const freeOf = (g: { memory_total_gib: number; memory_used_gib: number }) =>
    Math.max(0, g.memory_total_gib - g.memory_used_gib);
  const best = telemetry.gpus.reduce((a, b) => (freeOf(b) > freeOf(a) ? b : a));
  const free = freeOf(best) - reserveGib;
  if (budgetGib <= free) {
    return {
      ok: true,
      reason: `fits on GPU ${best.index} (${best.name}): needs ${f2(budgetGib)} GiB, ${f2(free)} GiB free after ${f2(reserveGib)} GiB reserve`,
      headroomGib: Math.round((free - budgetGib) * 100) / 100,
      gpuIndex: best.index,
    };
  }
  return no(
    `needs ${f2(budgetGib)} GiB but the roomiest GPU (${best.name}) has ${f2(Math.max(free, 0))} GiB free after the ${f2(reserveGib)} GiB reserve`,
  );
}

export interface Candidate {
  node: NodeView;
  admission: Admission;
}

export function evaluate(
  budgetGib: number,
  runtime: RuntimeKind,
  nodes: NodeView[],
  reserveGib: number,
  stateOf: (n: NodeView) => NodeState = (n) => n.state,
): Candidate[] {
  return nodes.map((node) => {
    const state = stateOf(node);
    if (state !== "online") {
      return {
        node,
        admission: { ok: false, reason: `node is ${state}`, headroomGib: 0, gpuIndex: null },
      };
    }
    return {
      node,
      admission: check(budgetGib, runtime, node.runtimes, node.telemetry, reserveGib),
    };
  });
}

/** Best fit: the admissible node with the least headroom left over. */
export function choose(candidates: Candidate[]): Candidate | null {
  const fitting = candidates.filter((c) => c.admission.ok);
  if (fitting.length === 0) return null;
  return fitting.reduce((a, b) => {
    if (b.admission.headroomGib !== a.admission.headroomGib) {
      return b.admission.headroomGib < a.admission.headroomGib ? b : a;
    }
    return b.node.name < a.node.name ? b : a;
  });
}
