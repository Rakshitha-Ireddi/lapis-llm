/** Wire types. These match the JSON the master returns from /api/*. */

import type { Quant } from "./sizing";

export type RuntimeKind = "llama.cpp" | "vllm" | "mlx" | "simulated";
export type Platform = "linux" | "windows" | "macos";
export type NodeState = "pending" | "online" | "offline" | "draining" | "revoked";
export type ModelState = "stopped" | "starting" | "running" | "failed";
export type Scope = "inference" | "metrics";

export interface GPU {
  index: number;
  name: string;
  memory_total_gib: number;
  memory_used_gib: number;
  utilization: number;
}

export interface Telemetry {
  platform: Platform;
  accelerator: string;
  unified_memory: boolean;
  memory_total_gib: number;
  memory_used_gib: number;
  gpus: GPU[];
  running: string[];
  tokens_per_second: number;
  requests_in_flight: number;
  disk_free_gib: number;
}

export interface NodeView {
  id: string;
  name: string;
  url: string;
  platform: Platform;
  runtimes: RuntimeKind[];
  fingerprint: string;
  state: NodeState;
  created_at: number;
  last_seen: number | null;
  telemetry: Telemetry | null;
  models: string[];
}

export interface ModelSpec {
  name: string;
  source: string;
  runtime: RuntimeKind;
  params_b: number;
  quant: Quant;
  context: number;
  parallel: number;
  memory_gib: number | null;
  /** Extra flags appended to the runtime command. */
  args?: string[];
}

export interface ModelView {
  spec: ModelSpec;
  node_id: string | null;
  node_name: string | null;
  desired: "running" | "stopped";
  state: ModelState;
  last_error: string | null;
  started_at: number | null;
  requests: number;
  tokens: number;
  budget_gib: number;
}

export interface Kpis {
  nodes_online: number;
  nodes_total: number;
  nodes_pending: number;
  models_running: number;
  models_total: number;
  tokens_per_second: number;
  requests_total: number;
  tokens_total: number;
  memory_total_gib: number;
  memory_free_gib: number;
}

export interface Overview {
  kpis: Kpis;
  nodes: NodeView[];
  models: ModelView[];
}

export interface PreviewRow {
  node_id: string;
  node_name: string;
  ok: boolean;
  reason: string;
  headroom_gib: number;
  chosen: boolean;
}

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  created_at: number;
  last_used_at: number | null;
}

export interface AuditEntry {
  at: number;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  node: string;
  tokens: number;
  ms: number;
}
