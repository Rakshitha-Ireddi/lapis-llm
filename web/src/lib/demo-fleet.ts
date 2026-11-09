/**
 * A simulated fleet that runs entirely in the browser. It powers the hero panel,
 * the console's demo mode on GitHub Pages, and the screenshots. It uses the same
 * admission and placement rules as the master, so refusals read the same.
 */

import { check, choose, evaluate } from "./admission";
import { PROFILES, type HardwareProfile } from "./hardware";
import { estimateMemoryGib } from "./sizing";
import type {
  ApiKeyView,
  AuditEntry,
  GPU,
  ModelSpec,
  ModelView,
  NodeView,
  Overview,
  PreviewRow,
  RuntimeKind,
  Scope,
  Telemetry,
} from "./types";

export class FleetError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "FleetError";
  }
}

/** Small deterministic PRNG so tests and screenshots are repeatable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function fingerprintFor(seed: string): string {
  const parts: string[] = [];
  let h = hash(seed);
  for (let i = 0; i < 16; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    parts.push((h & 0xff).toString(16).padStart(2, "0").toUpperCase());
  }
  return parts.join(":");
}

const NODE_NAMES: Record<string, string> = {
  "gaming-pc": "gaming-pc",
  "gaming-pc-16": "studio-pc",
  "linux-box": "linux-box",
  macbook: "macbook-pro",
  spark: "spark",
};

export const DEMO_MODELS: ModelSpec[] = [
  m("llama-3.3-70b-instruct", "meta-llama/Llama-3.3-70B-Instruct", "vllm", 70.6, "q4", 16384),
  m("qwen2.5-32b-instruct", "Qwen/Qwen2.5-32B-Instruct-AWQ", "vllm", 32.5, "q4", 8192),
  m("qwen2.5-coder-14b", "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF", "llama.cpp", 14.7, "q4", 16384),
  m("gemma-2-9b-it", "mlx-community/gemma-2-9b-it-4bit", "mlx", 9.2, "q5", 8192),
  m("llama-3.1-8b-instruct", "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF", "llama.cpp", 8, "q4", 8192),
  m("nomic-embed-text", "nomic-ai/nomic-embed-text-v1.5-GGUF", "llama.cpp", 0.14, "fp16", 2048),
  m("mistral-small-24b", "mlx-community/Mistral-Small-24B-Instruct-4bit", "mlx", 23.6, "q4", 8192),
];

export const DEMO_RUNNING = DEMO_MODELS.slice(0, 6).map((s) => s.name);

function m(
  name: string,
  source: string,
  runtime: RuntimeKind,
  params_b: number,
  quant: ModelSpec["quant"],
  context: number,
): ModelSpec {
  return { name, source, runtime, params_b, quant, context, parallel: 4, memory_gib: null };
}

export function budgetOf(spec: ModelSpec): number {
  return spec.memory_gib ?? estimateMemoryGib(spec.params_b, spec.quant, spec.context);
}

const SENTENCES = [
  "LapisLLM routed this request to the machine that serves the model you asked for.",
  "Every node checks its free memory before it agrees to start a model.",
  "Clients only ever see one base URL, no matter how many machines are behind it.",
  "Spare gaming PCs, old laptops and Apple Silicon Macs all count as capacity.",
  "Admission refuses a start with a plain-language reason instead of crashing later.",
  "Placement packs small models onto small machines so the big ones stay free.",
  "Streaming responses are relayed chunk by chunk from the agent to your client.",
  "Stopped models stay stopped after a reboot, running ones come back one at a time.",
  "API keys are scoped, hashed at rest and shown exactly once when created.",
  "This reply is simulated, so the demo fleet runs in your browser without a GPU.",
];

interface SimNode {
  view: NodeView;
  profile: HardwareProfile;
  gpuOf: Map<string, number | null>;
}

interface Sample {
  t: number;
  total: number;
  perNode: Record<string, number>;
}

export interface DemoOptions {
  seed?: number;
  now?: () => number;
  /** Start with the demo models placed and running. */
  populated?: boolean;
}

export class DemoFleet {
  readonly reserve = 1;
  private nodes: SimNode[] = [];
  private models = new Map<string, ModelView>();
  private load = new Map<string, number>();
  private keys: ApiKeyView[] = [];
  private log: AuditEntry[] = [];
  private requests = 0;
  private tokens = 0;
  private rand: () => number;
  private now: () => number;
  readonly history: Sample[] = [];

  constructor(options: DemoOptions = {}) {
    this.rand = mulberry32(options.seed ?? 7);
    this.now = options.now ?? (() => Date.now() / 1000);
    const t0 = this.now();

    PROFILES.forEach((p, i) => {
      const id = `node-${(0x3a7f1c + i * 0x1111).toString(16)}`;
      this.nodes.push({
        profile: p,
        gpuOf: new Map(),
        view: {
          id,
          name: NODE_NAMES[p.id] ?? p.id,
          url: `http://192.168.1.${20 + i}:8101`,
          platform: p.platform,
          runtimes: p.runtimes,
          fingerprint: fingerprintFor(p.id),
          state: "online",
          created_at: t0 - 86400 * (12 - i * 2),
          last_seen: t0,
          telemetry: null,
          models: [],
        },
      });
    });
    this.nodes.push({
      profile: {
        id: "old-laptop",
        label: "Gaming laptop",
        example: "RTX 2060 · 6 GB",
        platform: "windows",
        accelerator: "GeForce RTX 2060 Laptop",
        memoryGib: 6,
        unified: false,
        baseUsedGib: 0.5,
        runtimes: ["llama.cpp"],
        sweetSpot: "3B–7B",
      },
      gpuOf: new Map(),
      view: {
        id: "node-9c41d2",
        name: "old-laptop",
        url: "http://192.168.1.31:8101",
        platform: "windows",
        runtimes: ["llama.cpp"],
        fingerprint: fingerprintFor("old-laptop"),
        state: "pending",
        created_at: t0 - 90,
        last_seen: null,
        telemetry: null,
        models: [],
      },
    });
    this.nodes.forEach((n) => this.refresh(n));

    for (const spec of DEMO_MODELS) {
      this.models.set(spec.name, {
        spec: { ...spec },
        node_id: null,
        node_name: null,
        desired: "stopped",
        state: "stopped",
        last_error: null,
        started_at: null,
        requests: 0,
        tokens: 0,
        budget_gib: budgetOf(spec),
      });
    }
    this.record("system", "fleet.start", "", "demo fleet created");

    if (options.populated ?? true) {
      for (const name of DEMO_RUNNING) this.startModel(name, undefined, "demo");
      // Warm up so charts and counters aren't empty on first paint.
      for (let i = 0; i < 60; i++) this.tick(t0 - 60 + i);
      this.keys.push(
        this.newKey("vscode-agents", ["inference"], t0 - 86400 * 3).view,
        this.newKey("grafana", ["metrics"], t0 - 86400 * 6).view,
      );
    }
  }

  // ------------------------------------------------------------------ internals

  private node(id: string): SimNode {
    const node = this.nodes.find((n) => n.view.id === id);
    if (!node) throw new FleetError(`node '${id}' not found`, 404);
    return node;
  }

  private model(name: string): ModelView {
    const model = this.models.get(name);
    if (!model) throw new FleetError(`model '${name}' not found`, 404);
    return model;
  }

  private record(actor: string, action: string, target = "", detail = ""): void {
    this.log.unshift({ at: this.now(), actor, action, target, detail });
    this.log.length = Math.min(this.log.length, 200);
  }

  private onNode(node: SimNode): ModelView[] {
    return [...this.models.values()].filter(
      (m) => m.node_id === node.view.id && (m.state === "running" || m.state === "starting"),
    );
  }

  private refresh(node: SimNode): void {
    const p = node.profile;
    if (node.view.state === "pending" || node.view.state === "revoked") {
      node.view.telemetry = null;
      node.view.models = [];
      return;
    }
    const running = this.onNode(node);
    const tps = running.reduce((s, m) => s + (this.load.get(m.spec.name) ?? 0), 0);
    const busy = running.length ? Math.min(97, 8 + tps * 0.55) : 1;
    let gpus: GPU[] = [];
    let used: number;
    if (!p.unified) {
      const onGpu = running.reduce((s, m) => s + m.budget_gib, 0);
      gpus = [
        {
          index: 0,
          name: p.accelerator,
          memory_total_gib: p.memoryGib,
          memory_used_gib: round(Math.min(p.memoryGib, p.baseUsedGib + onGpu)),
          utilization: round(busy, 1),
        },
      ];
      used = gpus[0].memory_used_gib;
    } else {
      used = round(Math.min(p.memoryGib, p.baseUsedGib + running.reduce((s, m) => s + m.budget_gib, 0)));
    }
    const telemetry: Telemetry = {
      platform: p.platform,
      accelerator: p.accelerator,
      unified_memory: p.unified,
      memory_total_gib: p.memoryGib,
      memory_used_gib: used,
      gpus,
      running: running.map((m) => m.spec.name).sort(),
      tokens_per_second: round(tps, 1),
      requests_in_flight: Math.round(tps / 40),
      disk_free_gib: 300 + (hash(p.id) % 2000),
    };
    node.view.telemetry = telemetry;
    node.view.models = [...this.models.values()]
      .filter((m) => m.node_id === node.view.id)
      .map((m) => m.spec.name)
      .sort();
  }

  private refreshAll(): void {
    this.nodes.forEach((n) => this.refresh(n));
    for (const model of this.models.values()) {
      model.node_name = model.node_id ? this.node(model.node_id).view.name : null;
    }
  }

  private newKey(name: string, scopes: Scope[], at = this.now()) {
    const raw = `lap_${Array.from({ length: 32 }, () => "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(this.rand() * 57)]).join("")}`;
    const view: ApiKeyView = {
      id: `key-${Math.floor(this.rand() * 0xffffff).toString(16).padStart(6, "0")}`,
      name,
      prefix: raw.slice(0, 8),
      scopes,
      created_at: at,
      last_used_at: scopes.includes("inference") ? this.now() - 40 : null,
    };
    return { view, key: raw };
  }

  // ------------------------------------------------------------------ simulation

  /** Advance one second of simulated traffic. */
  tick(at = this.now()): void {
    const perNode: Record<string, number> = {};
    for (const model of this.models.values()) {
      if (model.state !== "running") {
        this.load.delete(model.spec.name);
        continue;
      }
      const nominal = 600 / (model.spec.params_b + 1.5);
      const weight = model.spec.name.includes("embed") ? 0.03 : 1;
      const prev = this.load.get(model.spec.name) ?? nominal * 0.6;
      const target = nominal * weight * (0.5 + this.rand() * 1.6);
      const tps = Math.max(0, prev + (target - prev) * 0.35);
      this.load.set(model.spec.name, tps);
      const reqs = Math.max(0, Math.round(tps / 55 + this.rand() * 0.8));
      model.requests += reqs;
      model.tokens += Math.round(tps);
      this.requests += reqs;
      this.tokens += Math.round(tps);
      if (model.node_name) perNode[model.node_name] = (perNode[model.node_name] ?? 0) + tps;
    }
    for (const n of this.nodes) if (n.view.state === "online" || n.view.state === "draining") n.view.last_seen = at;
    const total = Object.values(perNode).reduce((a, b) => a + b, 0);
    this.history.push({ t: at, total: round(total, 1), perNode });
    if (this.history.length > 120) this.history.shift();
    this.refreshAll();
  }

  overview(): Overview {
    const nodes = this.nodes.map((n) => structuredClone(n.view));
    const models = [...this.models.values()].map((v) => structuredClone(v));
    const live = nodes.filter((n) => (n.state === "online" || n.state === "draining") && n.telemetry);
    return {
      kpis: {
        nodes_online: live.length,
        nodes_total: nodes.filter((n) => n.state !== "revoked").length,
        nodes_pending: nodes.filter((n) => n.state === "pending").length,
        models_running: models.filter((x) => x.state === "running").length,
        models_total: models.length,
        tokens_per_second: round(live.reduce((s, n) => s + (n.telemetry?.tokens_per_second ?? 0), 0), 1),
        requests_total: this.requests,
        tokens_total: this.tokens,
        memory_total_gib: round(live.reduce((s, n) => s + (n.telemetry?.memory_total_gib ?? 0), 0)),
        memory_free_gib: round(
          live.reduce(
            (s, n) => s + Math.max(0, (n.telemetry?.memory_total_gib ?? 0) - (n.telemetry?.memory_used_gib ?? 0)),
            0,
          ),
        ),
      },
      nodes,
      models,
    };
  }

  // ------------------------------------------------------------------ models

  addModel(spec: ModelSpec, actor = "admin"): ModelView {
    if (!/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(spec.name)) {
      throw new FleetError("name: model name must be lowercase letters, digits, '.', '_', ':' or '-'", 422);
    }
    if (this.models.has(spec.name)) throw new FleetError(`model '${spec.name}' already exists`);
    const view: ModelView = {
      spec: { ...spec },
      node_id: null,
      node_name: null,
      desired: "stopped",
      state: "stopped",
      last_error: null,
      started_at: null,
      requests: 0,
      tokens: 0,
      budget_gib: budgetOf(spec),
    };
    this.models.set(spec.name, view);
    this.record(actor, "model.add", spec.name, `${spec.runtime} ${view.budget_gib} GiB`);
    return structuredClone(view);
  }

  removeModel(name: string, actor = "admin"): void {
    const model = this.model(name);
    if (model.state === "running" || model.state === "starting") {
      throw new FleetError(`stop ${name} before removing it`);
    }
    this.models.delete(name);
    this.record(actor, "model.remove", name);
    this.refreshAll();
  }

  preview(spec: ModelSpec): PreviewRow[] {
    const budget = budgetOf(spec);
    const visible = this.nodes.filter((n) => n.view.state !== "pending" && n.view.state !== "revoked");
    const candidates = evaluate(budget, spec.runtime, visible.map((n) => n.view), this.reserve);
    const best = choose(candidates);
    return candidates.map((c) => ({
      node_id: c.node.id,
      node_name: c.node.name,
      ok: c.admission.ok,
      reason: c.admission.reason,
      headroom_gib: c.admission.headroomGib,
      chosen: best?.node.id === c.node.id,
    }));
  }

  startModel(name: string, nodeId?: string, actor = "admin"): ModelView {
    const model = this.model(name);
    model.desired = "running";
    if (model.state === "running") return structuredClone(model);
    let target: SimNode;
    if (nodeId) {
      target = this.node(nodeId);
      if (target.view.state !== "online") throw new FleetError(`node ${target.view.name} is ${target.view.state}`);
    } else {
      const visible = this.nodes.filter((n) => n.view.state !== "pending" && n.view.state !== "revoked");
      const candidates = evaluate(model.budget_gib, model.spec.runtime, visible.map((n) => n.view), this.reserve);
      const chosen = choose(candidates);
      if (!chosen) {
        const reasons = candidates.map((c) => `${c.node.name}: ${c.admission.reason}`).join("; ");
        model.state = "failed";
        model.last_error = `no node can run ${name} (${reasons})`;
        this.record(actor, "model.start.refused", name, model.last_error);
        throw new FleetError(model.last_error);
      }
      target = this.node(chosen.node.id);
    }
    const adm = check(model.budget_gib, model.spec.runtime, target.view.runtimes, target.view.telemetry, this.reserve);
    if (!adm.ok) {
      model.state = "failed";
      model.last_error = adm.reason;
      this.record(actor, "model.start.refused", name, adm.reason);
      throw new FleetError(`${target.view.name} refused ${name}: ${adm.reason}`);
    }
    model.node_id = target.view.id;
    model.state = "running";
    model.last_error = null;
    model.started_at = this.now();
    target.gpuOf.set(name, adm.gpuIndex);
    this.record(actor, "model.start", name, target.view.name);
    this.refreshAll();
    return structuredClone(model);
  }

  stopModel(name: string, actor = "admin"): ModelView {
    const model = this.model(name);
    model.desired = "stopped";
    model.state = "stopped";
    model.last_error = null;
    this.load.delete(name);
    this.record(actor, "model.stop", name);
    this.refreshAll();
    return structuredClone(model);
  }

  moveModel(name: string, nodeId: string, actor = "admin"): ModelView {
    const model = this.model(name);
    const target = this.node(nodeId);
    if (model.node_id === nodeId) throw new FleetError(`${name} is already on ${target.view.name}`);
    if (target.view.state !== "online") throw new FleetError(`node ${target.view.name} is ${target.view.state}`);
    const adm = check(model.budget_gib, model.spec.runtime, target.view.runtimes, target.view.telemetry, this.reserve);
    if (!adm.ok) throw new FleetError(`${target.view.name} cannot take ${name}: ${adm.reason}`);
    const wasRunning = model.state === "running";
    if (wasRunning) this.stopModel(name, actor);
    model.node_id = nodeId;
    if (wasRunning) this.startModel(name, nodeId, actor);
    this.record(actor, "model.move", name, target.view.name);
    this.refreshAll();
    return structuredClone(model);
  }

  // ------------------------------------------------------------------ nodes

  approve(nodeId: string, fingerprint: string, actor = "admin"): NodeView {
    const node = this.node(nodeId);
    if (node.view.state !== "pending") throw new FleetError(`node ${node.view.name} is ${node.view.state}, not pending`);
    const norm = (s: string) => s.toUpperCase().replace(/[^0-9A-F]/g, "");
    if (norm(fingerprint) !== norm(node.view.fingerprint)) {
      this.record(actor, "node.approve.mismatch", nodeId, fingerprint);
      throw new FleetError("fingerprint does not match what the agent printed", 403);
    }
    node.view.state = "online";
    node.view.last_seen = this.now();
    this.record(actor, "node.approve", nodeId, node.view.name);
    this.refreshAll();
    return structuredClone(node.view);
  }

  drain(nodeId: string, actor = "admin"): NodeView {
    const node = this.node(nodeId);
    if (node.view.state !== "online") throw new FleetError(`node ${node.view.name} is ${node.view.state}`);
    node.view.state = "draining";
    this.record(actor, "node.drain", nodeId, node.view.name);
    return structuredClone(node.view);
  }

  undrain(nodeId: string, actor = "admin"): NodeView {
    const node = this.node(nodeId);
    if (node.view.state !== "draining") throw new FleetError(`node ${node.view.name} is not draining`);
    node.view.state = "online";
    this.record(actor, "node.undrain", nodeId, node.view.name);
    return structuredClone(node.view);
  }

  revoke(nodeId: string, actor = "admin"): NodeView {
    const node = this.node(nodeId);
    node.view.state = "revoked";
    for (const model of this.models.values()) {
      if (model.node_id === nodeId) {
        model.node_id = null;
        model.state = "stopped";
        this.load.delete(model.spec.name);
      }
    }
    this.record(actor, "node.revoke", nodeId, node.view.name);
    this.refreshAll();
    return structuredClone(node.view);
  }

  removeNode(nodeId: string, actor = "admin"): void {
    const node = this.node(nodeId);
    if (node.view.state !== "pending" && node.view.state !== "revoked") {
      throw new FleetError("revoke the node before removing it");
    }
    this.nodes = this.nodes.filter((n) => n !== node);
    this.record(actor, "node.remove", nodeId, node.view.name);
  }

  // ------------------------------------------------------------------ keys, audit

  listKeys(): ApiKeyView[] {
    return this.keys.map((k) => ({ ...k }));
  }

  createKey(name: string, scopes: Scope[], actor = "admin"): ApiKeyView & { key: string } {
    const { view, key } = this.newKey(name, scopes);
    view.last_used_at = null;
    this.keys.push(view);
    this.record(actor, "key.create", view.id, `${name} [${scopes.join(", ")}]`);
    return { ...view, key };
  }

  revokeKey(id: string, actor = "admin"): void {
    const key = this.keys.find((k) => k.id === id);
    if (!key) throw new FleetError(`key '${id}' not found`, 404);
    this.keys = this.keys.filter((k) => k.id !== id);
    this.record(actor, "key.revoke", id, key.name);
  }

  audit(limit = 100): AuditEntry[] {
    return this.log.slice(0, limit).map((e) => ({ ...e }));
  }

  // ------------------------------------------------------------------ inference

  route(name: string): { model: ModelView; node: NodeView } {
    const model = this.models.get(name);
    if (!model) throw new FleetError(`The model '${name}' does not exist`, 404);
    if (model.state !== "running" || !model.node_id) throw new FleetError(`The model '${name}' is not running`, 503);
    return { model, node: this.node(model.node_id).view };
  }

  reply(name: string, prompt: string, maxTokens = 96): string {
    const { node } = this.route(name);
    const seed = hash(prompt + name);
    const picked = [0, 1, 2].map((i) => SENTENCES[(seed + i * 7) % SENTENCES.length]);
    const words = `Hi from ${name} on ${node.name}. ${[...new Set(picked)].join(" ")}`.split(" ");
    return words.slice(0, Math.max(1, maxTokens)).join(" ");
  }

  recordChat(name: string, tokens: number): void {
    const model = this.model(name);
    model.requests += 1;
    model.tokens += tokens;
    this.requests += 1;
    this.tokens += tokens;
  }
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
