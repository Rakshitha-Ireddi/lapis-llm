/**
 * The console talks to a FleetApi. Two implementations:
 *  - DemoApi: an in-browser simulated fleet (GitHub Pages, screenshots).
 *  - LiveApi: a real LapisLLM master over HTTP.
 */

import { DemoFleet, FleetError } from "../lib/demo-fleet";
import type {
  ApiKeyView,
  AuditEntry,
  ChatMessage,
  ChatResult,
  ModelSpec,
  ModelView,
  NodeView,
  Overview,
  PreviewRow,
  Scope,
} from "../lib/types";
import { budgetOf } from "../lib/demo-fleet";

export type Delta = (text: string) => void;

export interface Preview {
  budget_gib: number;
  nodes: PreviewRow[];
}

export interface FleetApi {
  readonly mode: "demo" | "live";
  readonly label: string;
  readonly baseUrl: string;
  overview(): Promise<Overview>;
  addModel(spec: ModelSpec): Promise<ModelView>;
  removeModel(name: string): Promise<void>;
  startModel(name: string, nodeId?: string): Promise<ModelView>;
  stopModel(name: string): Promise<ModelView>;
  moveModel(name: string, nodeId: string): Promise<ModelView>;
  preview(spec: ModelSpec): Promise<Preview>;
  approve(nodeId: string, fingerprint: string): Promise<NodeView>;
  drain(nodeId: string): Promise<NodeView>;
  undrain(nodeId: string): Promise<NodeView>;
  revoke(nodeId: string): Promise<NodeView>;
  removeNode(nodeId: string): Promise<void>;
  keys(): Promise<ApiKeyView[]>;
  createKey(name: string, scopes: Scope[]): Promise<ApiKeyView & { key: string }>;
  revokeKey(id: string): Promise<void>;
  audit(): Promise<AuditEntry[]>;
  chat(model: string, messages: ChatMessage[], onDelta: Delta, signal?: AbortSignal): Promise<ChatResult>;
  /** Advance simulated time (demo only). */
  tick?(): void;
  /** Throughput samples gathered before the console opened (demo only). */
  seedHistory?(): { total: number; perNode: Record<string, number> }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------- demo

export class DemoApi implements FleetApi {
  readonly mode = "demo" as const;
  readonly label = "Demo fleet · simulated in your browser";
  readonly baseUrl = "http://lapis.local:8080";
  readonly fleet: DemoFleet;

  constructor(fleet = new DemoFleet({ seed: 11 })) {
    this.fleet = fleet;
  }

  private async run<T>(fn: () => T): Promise<T> {
    await sleep(120); // feel like a network call
    try {
      return fn();
    } catch (err) {
      if (err instanceof FleetError) throw new ApiError(err.message, err.status);
      throw err;
    }
  }

  tick() {
    this.fleet.tick();
  }

  seedHistory() {
    return this.fleet.history.map((s) => ({ total: s.total, perNode: s.perNode }));
  }

  overview = () => Promise.resolve(this.fleet.overview());
  addModel = (spec: ModelSpec) => this.run(() => this.fleet.addModel(spec));
  removeModel = (name: string) => this.run(() => this.fleet.removeModel(name));
  startModel = (name: string, nodeId?: string) => this.run(() => this.fleet.startModel(name, nodeId));
  stopModel = (name: string) => this.run(() => this.fleet.stopModel(name));
  moveModel = (name: string, nodeId: string) => this.run(() => this.fleet.moveModel(name, nodeId));
  preview = (spec: ModelSpec) =>
    this.run(() => ({ budget_gib: budgetOf(spec), nodes: this.fleet.preview(spec) }));
  approve = (id: string, fp: string) => this.run(() => this.fleet.approve(id, fp));
  drain = (id: string) => this.run(() => this.fleet.drain(id));
  undrain = (id: string) => this.run(() => this.fleet.undrain(id));
  revoke = (id: string) => this.run(() => this.fleet.revoke(id));
  removeNode = (id: string) => this.run(() => this.fleet.removeNode(id));
  keys = () => Promise.resolve(this.fleet.listKeys());
  createKey = (name: string, scopes: Scope[]) => this.run(() => this.fleet.createKey(name, scopes));
  revokeKey = (id: string) => this.run(() => this.fleet.revokeKey(id));
  audit = () => Promise.resolve(this.fleet.audit());

  async chat(model: string, messages: ChatMessage[], onDelta: Delta, signal?: AbortSignal): Promise<ChatResult> {
    const started = performance.now();
    const { node, model: view } = await this.run(() => this.fleet.route(model));
    const prompt = messages[messages.length - 1]?.content ?? "";
    const text = this.fleet.reply(model, prompt);
    const words = text.split(" ");
    const delay = Math.max(14, Math.min(70, 1000 / (600 / (view.spec.params_b + 1.5))));
    for (let i = 0; i < words.length; i++) {
      if (signal?.aborted) break;
      onDelta((i ? " " : "") + words[i]);
      await sleep(delay);
    }
    this.fleet.recordChat(model, words.length);
    return { node: node.name, tokens: words.length, ms: performance.now() - started };
  }
}

// --------------------------------------------------------------------------- live

const TOKEN_KEY = "lapis-admin-token";

export class LiveApi implements FleetApi {
  readonly mode = "live" as const;
  readonly label: string;
  private token: string | null;

  constructor(readonly baseUrl: string) {
    this.label = `Live · ${baseUrl.replace(/^https?:\/\//, "") || location.host}`;
    this.token = LiveApi.storedToken(baseUrl);
  }

  static storedToken(baseUrl: string): string | null {
    try {
      return sessionStorage.getItem(`${TOKEN_KEY}:${baseUrl}`);
    } catch {
      return null;
    }
  }

  get authenticated(): boolean {
    return this.token !== null;
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  async login(password: string): Promise<void> {
    const res = await fetch(this.url("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body?.error?.message ?? "login failed", res.status);
    this.token = body.token as string;
    try {
      sessionStorage.setItem(`${TOKEN_KEY}:${this.baseUrl}`, this.token);
    } catch {
      /* session only */
    }
  }

  logout(): void {
    this.token = null;
    try {
      sessionStorage.removeItem(`${TOKEN_KEY}:${this.baseUrl}`);
    } catch {
      /* ignore */
    }
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method,
      headers: {
        Authorization: `Bearer ${this.token ?? ""}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 403 && path !== "/api/auth/login") this.logout();
      throw new ApiError(data?.error?.message ?? `HTTP ${res.status}`, res.status);
    }
    return data as T;
  }

  overview = () => this.req<Overview>("GET", "/api/overview");
  addModel = (spec: ModelSpec) => this.req<ModelView>("POST", "/api/models", spec);
  removeModel = (name: string) => this.req<void>("DELETE", `/api/models/${encodeURIComponent(name)}`);
  startModel = (name: string, nodeId?: string) =>
    this.req<ModelView>("POST", `/api/models/${encodeURIComponent(name)}/start`, nodeId ? { node_id: nodeId } : {});
  stopModel = (name: string) => this.req<ModelView>("POST", `/api/models/${encodeURIComponent(name)}/stop`);
  moveModel = (name: string, nodeId: string) =>
    this.req<ModelView>("POST", `/api/models/${encodeURIComponent(name)}/move`, { node_id: nodeId });
  preview = (spec: ModelSpec) => this.req<Preview>("POST", "/api/models/preview", spec);
  approve = (id: string, fingerprint: string) =>
    this.req<NodeView>("POST", `/api/nodes/${id}/approve`, { fingerprint });
  drain = (id: string) => this.req<NodeView>("POST", `/api/nodes/${id}/drain`);
  undrain = (id: string) => this.req<NodeView>("POST", `/api/nodes/${id}/undrain`);
  revoke = (id: string) => this.req<NodeView>("POST", `/api/nodes/${id}/revoke`);
  removeNode = (id: string) => this.req<void>("DELETE", `/api/nodes/${id}`);
  keys = () => this.req<ApiKeyView[]>("GET", "/api/keys");
  createKey = (name: string, scopes: Scope[]) =>
    this.req<ApiKeyView & { key: string }>("POST", "/api/keys", { name, scopes });
  revokeKey = (id: string) => this.req<void>("DELETE", `/api/keys/${id}`);
  audit = () => this.req<AuditEntry[]>("GET", "/api/audit");

  async chat(model: string, messages: ChatMessage[], onDelta: Delta, signal?: AbortSignal): Promise<ChatResult> {
    const started = performance.now();
    const res = await fetch(this.url("/v1/chat/completions"), {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${this.token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data?.error?.message ?? `HTTP ${res.status}`, res.status);
    }
    const node = res.headers.get("X-Lapis-Node") ?? "?";
    let tokens = 0;
    for await (const event of sseEvents(res.body)) {
      if (event === "[DONE]") break;
      try {
        const chunk = JSON.parse(event);
        const piece = chunk?.choices?.[0]?.delta?.content;
        if (piece) {
          tokens += 1;
          onDelta(piece);
        }
        if (chunk?.usage?.completion_tokens) tokens = chunk.usage.completion_tokens;
      } catch {
        /* ignore keep-alives */
      }
    }
    return { node, tokens, ms: performance.now() - started };
  }
}

/** Yield the `data:` payloads of a server-sent-events stream. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of raw.split("\n")) {
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
  }
}
