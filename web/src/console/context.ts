import type { Overview } from "../lib/types";
import type { FleetApi } from "./api";

export interface Sample {
  total: number;
  perNode: Record<string, number>;
}

export interface Ctx {
  api: FleetApi;
  data: Overview;
  history: Sample[];
  /** Re-fetch the overview and update the current view. */
  refresh(): Promise<void>;
  /** Run a mutating call: toast on success/failure, then refresh. */
  act<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined>;
  navigate(route: string): void;
}

export interface View {
  title: string;
  subtitle(ctx: Ctx): string;
  /** Build the view's DOM and bind events. Called once per visit. */
  mount(root: HTMLElement, ctx: Ctx): void;
  /** Called after every data refresh while the view is visible. */
  update(ctx: Ctx): void;
  /** Optional buttons for the top bar. */
  actions?(ctx: Ctx): HTMLElement[];
  unmount?(): void;
}

export const EMPTY: Overview = {
  kpis: {
    nodes_online: 0,
    nodes_total: 0,
    nodes_pending: 0,
    models_running: 0,
    models_total: 0,
    tokens_per_second: 0,
    requests_total: 0,
    tokens_total: 0,
    memory_total_gib: 0,
    memory_free_gib: 0,
  },
  nodes: [],
  models: [],
};

export function button(label: string, iconHtml: string, className = "btn"): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.innerHTML = `${iconHtml}<span>${label}</span>`;
  return b;
}
