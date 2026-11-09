import { describe, expect, it } from "vitest";
import { DEMO_RUNNING, DemoFleet, FleetError, hash, mulberry32 } from "../src/lib/demo-fleet";
import type { ModelSpec } from "../src/lib/types";

const now = () => 1_700_000_000;
const spec = (name: string, params_b: number, extra: Partial<ModelSpec> = {}): ModelSpec => ({
  name,
  source: "",
  runtime: "llama.cpp",
  params_b,
  quant: "q4",
  context: 8192,
  parallel: 4,
  memory_gib: null,
  ...extra,
});

describe("DemoFleet", () => {
  it("starts populated with placements that mirror the Python demo", () => {
    const fleet = new DemoFleet({ now });
    const { kpis, models } = fleet.overview();
    expect(kpis.models_running).toBe(DEMO_RUNNING.length);
    expect(kpis.nodes_online).toBe(5);
    expect(kpis.nodes_pending).toBe(1);
    const where = Object.fromEntries(models.map((m) => [m.spec.name, m.node_name]));
    expect(where["llama-3.3-70b-instruct"]).toBe("spark");
    expect(where["qwen2.5-32b-instruct"]).toBe("linux-box");
    expect(where["qwen2.5-coder-14b"]).toBe("studio-pc");
    expect(where["llama-3.1-8b-instruct"]).toBe("gaming-pc");
    expect(where["gemma-2-9b-it"]).toBe("macbook-pro");
  });

  it("is deterministic for a seed", () => {
    const a = new DemoFleet({ seed: 3, now });
    const b = new DemoFleet({ seed: 3, now });
    a.tick();
    b.tick();
    expect(a.overview().kpis.tokens_total).toBe(b.overview().kpis.tokens_total);
  });

  it("refuses models that fit nowhere, explaining every node", () => {
    const fleet = new DemoFleet({ now, populated: false });
    fleet.addModel(spec("huge", 405));
    expect(() => fleet.startModel("huge")).toThrowError(/no node can run huge \(gaming-pc: needs/);
    expect(fleet.overview().models.find((m) => m.spec.name === "huge")?.state).toBe("failed");
  });

  it("validates names and duplicates", () => {
    const fleet = new DemoFleet({ now, populated: false });
    expect(() => fleet.addModel(spec("Bad Name", 1))).toThrow(FleetError);
    fleet.addModel(spec("ok", 1));
    expect(() => fleet.addModel(spec("ok", 1))).toThrow(/already exists/);
  });

  it("approves only with the matching fingerprint", () => {
    const fleet = new DemoFleet({ now });
    const pending = fleet.overview().nodes.find((n) => n.state === "pending")!;
    expect(() => fleet.approve(pending.id, "AA:BB")).toThrow(/does not match/);
    const approved = fleet.approve(pending.id, pending.fingerprint.toLowerCase().replace(/:/g, ""));
    expect(approved.state).toBe("online");
    expect(fleet.overview().kpis.nodes_online).toBe(6);
  });

  it("drain blocks placement; revoke stops models", () => {
    const fleet = new DemoFleet({ now, populated: false });
    const pc = fleet.overview().nodes.find((n) => n.name === "gaming-pc")!;
    fleet.addModel(spec("small", 3));
    fleet.drain(pc.id);
    expect(fleet.preview(spec("small", 3)).find((r) => r.node_id === pc.id)?.reason).toBe("node is draining");
    fleet.undrain(pc.id);
    fleet.startModel("small", pc.id);
    fleet.revoke(pc.id);
    const model = fleet.overview().models.find((m) => m.spec.name === "small")!;
    expect(model.state).toBe("stopped");
    expect(model.node_id).toBeNull();
  });

  it("moves running models and keeps them running", () => {
    const fleet = new DemoFleet({ now });
    const box = fleet.overview().nodes.find((n) => n.name === "spark")!;
    const moved = fleet.moveModel("llama-3.1-8b-instruct", box.id);
    expect(moved.state).toBe("running");
    expect(moved.node_id).toBe(box.id);
  });

  it("creates keys once and lists them without the secret", () => {
    const fleet = new DemoFleet({ now });
    const created = fleet.createKey("laptop", ["inference"]);
    expect(created.key).toMatch(/^lap_/);
    const listed = fleet.listKeys().find((k) => k.id === created.id)!;
    expect(listed).not.toHaveProperty("key");
    fleet.revokeKey(created.id);
    expect(fleet.listKeys().some((k) => k.id === created.id)).toBe(false);
    expect(fleet.audit().map((e) => e.action)).toContain("key.revoke");
  });

  it("routes chat to the serving node with a deterministic reply", () => {
    const fleet = new DemoFleet({ now });
    const a = fleet.reply("qwen2.5-coder-14b", "hi");
    expect(a).toBe(fleet.reply("qwen2.5-coder-14b", "hi"));
    expect(a.startsWith("Hi from qwen2.5-coder-14b on studio-pc.")).toBe(true);
    expect(() => fleet.reply("mistral-small-24b", "hi")).toThrow(/not running/);
  });
});

describe("helpers", () => {
  it("mulberry32 is in [0, 1) and repeatable", () => {
    const r1 = mulberry32(1);
    const r2 = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("hash is stable", () => {
    expect(hash("lapis")).toBe(hash("lapis"));
    expect(hash("lapis")).not.toBe(hash("lazuli"));
  });
});
