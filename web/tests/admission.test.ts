import { describe, expect, it } from "vitest";
import { check, choose, evaluate } from "../src/lib/admission";
import type { NodeView, Telemetry } from "../src/lib/types";

const unified = (total: number, used: number): Telemetry => ({
  platform: "macos",
  accelerator: "M3",
  unified_memory: true,
  memory_total_gib: total,
  memory_used_gib: used,
  gpus: [],
  running: [],
  tokens_per_second: 0,
  requests_in_flight: 0,
  disk_free_gib: 100,
});

const discrete = (...gpus: [number, number][]): Telemetry => ({
  ...unified(0, 0),
  platform: "linux",
  unified_memory: false,
  gpus: gpus.map(([total, used], index) => ({
    index,
    name: `GPU${index}`,
    memory_total_gib: total,
    memory_used_gib: used,
    utilization: 0,
  })),
});

const node = (name: string, telemetry: Telemetry, state: NodeView["state"] = "online"): NodeView => ({
  id: `node-${name}`,
  name,
  url: `http://${name}`,
  platform: telemetry.platform,
  runtimes: ["simulated", "llama.cpp"],
  fingerprint: "00",
  state,
  created_at: 0,
  last_seen: 0,
  telemetry,
  models: [],
});

describe("check (mirrors server admission)", () => {
  it("admits on unified memory with identical wording", () => {
    const a = check(10, "simulated", ["simulated"], unified(36, 9), 1);
    expect(a.ok).toBe(true);
    expect(a.headroomGib).toBe(16);
    expect(a.reason).toBe("fits: needs 10.00 GiB, 26.00 GiB free after 1.00 GiB reserve");
  });

  it("refuses with the same reason text as the master", () => {
    const a = check(30, "simulated", ["simulated"], unified(36, 9), 1);
    expect(a.reason).toBe("needs 30.00 GiB but only 26.00 GiB is free after the 1.00 GiB reserve");
  });

  it("checks discrete GPUs one card at a time", () => {
    expect(check(10, "simulated", ["simulated"], discrete([8, 0], [8, 0]), 0.5).ok).toBe(false);
    const roomy = check(10, "simulated", ["simulated"], discrete([24, 20], [24, 2]), 1);
    expect(roomy.ok).toBe(true);
    expect(roomy.gpuIndex).toBe(1);
  });

  it("requires the runtime and telemetry", () => {
    expect(check(1, "vllm", ["mlx"], unified(64, 0), 1).reason).toBe(
      "node does not offer runtime vllm (offers mlx)",
    );
    expect(check(1, "simulated", ["simulated"], null, 1).ok).toBe(false);
  });
});

describe("placement", () => {
  it("picks the tightest fit", () => {
    const nodes = [node("spark", unified(128, 6)), node("gaming-pc", discrete([8, 0.6])), node("box", discrete([24, 0.4]))];
    expect(choose(evaluate(5.79, "simulated", nodes, 1))?.node.name).toBe("gaming-pc");
  });

  it("skips draining nodes and reports why", () => {
    const nodes = [node("pc", discrete([8, 0]), "draining"), node("box", discrete([24, 0]))];
    const candidates = evaluate(5, "simulated", nodes, 1);
    expect(candidates[0].admission.reason).toBe("node is draining");
    expect(choose(candidates)?.node.name).toBe("box");
  });

  it("returns null when nothing fits", () => {
    expect(choose(evaluate(70, "simulated", [node("pc", discrete([8, 0]))], 1))).toBeNull();
  });
});
