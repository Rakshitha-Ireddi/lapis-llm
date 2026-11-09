import "../styles/glass.css";
import "../styles/console.css";
import "../styles/liquid.css";

import { $, $$, hydrateIcons, toast } from "../ui/dom";
import { icon } from "../ui/icons";
import { bindThemeToggles, initTheme } from "../ui/theme";
import { ApiError, DemoApi, LiveApi, type FleetApi } from "./api";
import { EMPTY, type Ctx, type Sample, type View } from "./context";
import { accessView } from "./views/access";
import { auditView } from "./views/audit";
import { modelsView } from "./views/models";
import { nodesView } from "./views/nodes";
import { overviewView } from "./views/overview";
import { playgroundView } from "./views/playground";

const ROUTES: Record<string, View> = {
  overview: overviewView,
  models: modelsView,
  nodes: nodesView,
  playground: playgroundView,
  access: accessView,
  audit: auditView,
};

const POLL_MS = 1000;
const HISTORY = 120;

initTheme();
hydrateIcons();
bindThemeToggles();

// ------------------------------------------------------------------ choose an API

async function isMaster(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/healthz`, { cache: "no-store" });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.service === "lapis-master";
  } catch {
    return false;
  }
}

async function chooseApi(): Promise<FleetApi> {
  const params = new URLSearchParams(location.search);
  if (params.has("demo")) return new DemoApi();
  const explicit = params.get("api");
  if (explicit) return new LiveApi(explicit.replace(/\/$/, ""));
  // Served by a master (or the Vite dev proxy)? Then talk to it.
  if (await isMaster(location.origin)) return new LiveApi(location.origin);
  return new DemoApi();
}

// ------------------------------------------------------------------ app

const viewHost = $("#view");
let current: View | null = null;
let api: FleetApi;
let timer = 0;

const ctx: Ctx = {
  api: undefined as unknown as FleetApi,
  data: EMPTY,
  history: [],
  async refresh() {
    try {
      ctx.data = await ctx.api.overview();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && ctx.api instanceof LiveApi) {
        openConnect(ctx.api.baseUrl, "Your session expired. Log in again.");
      }
      return;
    }
    const perNode: Record<string, number> = {};
    for (const n of ctx.data.nodes) {
      if (n.telemetry) perNode[n.name] = n.telemetry.tokens_per_second;
    }
    ctx.history.push({ total: ctx.data.kpis.tokens_per_second, perNode });
    if (ctx.history.length > HISTORY) ctx.history.shift();
    renderChrome();
    current?.update(ctx);
  },
  async act(fn, success) {
    try {
      const result = await fn();
      if (success) toast(success);
      await ctx.refresh();
      return result;
    } catch (err) {
      toast((err as Error).message, "bad");
      await ctx.refresh();
      return undefined;
    }
  },
  navigate(route) {
    location.hash = `#/${route}`;
  },
};

function renderChrome(): void {
  const badge = $("#pending-badge");
  const pending = ctx.data.kpis.nodes_pending;
  badge.hidden = pending === 0;
  badge.textContent = String(pending);
  if (current) $("#view-sub").textContent = current.subtitle(ctx);
}

function routeName(): string {
  const name = location.hash.replace(/^#\/?/, "") || "overview";
  return name in ROUTES ? name : "overview";
}

function mountRoute(): void {
  const name = routeName();
  current?.unmount?.();
  current = ROUTES[name];

  // A fresh host element per visit, so listeners from the last visit go away.
  const host = document.createElement("div");
  host.className = "view";
  viewHost.replaceChildren(host);

  $("#view-title").textContent = current.title;
  $("#view-sub").textContent = current.subtitle(ctx);
  document.title = `${current.title} · LapisLLM Console`;
  const actions = $("#view-actions");
  actions.replaceChildren(...(current.actions?.(ctx) ?? []));

  $$<HTMLAnchorElement>(".sidenav a").forEach((a) => {
    if (a.dataset.route === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  closeSidebar();
  current.mount(host, ctx);
  hydrateIcons(host);
}

function startPolling(): void {
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (document.hidden) return;
    api.tick?.();
    void ctx.refresh();
  }, POLL_MS);
}

// ------------------------------------------------------------------ chrome: sidebar, mode, connect

const sidebar = $("#sidebar");
const sidebarToggle = $<HTMLButtonElement>(".sidebar-toggle");
function closeSidebar(): void {
  sidebar.classList.remove("is-open");
  sidebarToggle.setAttribute("aria-expanded", "false");
}
sidebarToggle.addEventListener("click", () => {
  const open = sidebar.classList.toggle("is-open");
  sidebarToggle.setAttribute("aria-expanded", String(open));
});

function renderMode(): void {
  const pill = $("#mode-pill");
  pill.textContent = api.mode;
  pill.className = `pill ${api.mode === "live" ? "pill--online" : ""}`;
  $("#mode-label").textContent = api.label;
  $("#connect-btn").innerHTML =
    api.mode === "live" ? `${icon("refresh")}Switch to demo` : `${icon("plug")}Connect a master`;
}

const dialog = $<HTMLDialogElement>("#connect-dialog");
const form = $<HTMLFormElement>("#connect-form");

function openConnect(url = "", message = ""): void {
  (form.elements.namedItem("url") as HTMLInputElement).value = url || "http://localhost:8080";
  $("#connect-error").textContent = message;
  if (!dialog.open) dialog.showModal();
}

$("#connect-btn").addEventListener("click", () => {
  if (api.mode === "live") {
    (api as LiveApi).logout();
    location.href = `${location.pathname}?demo${location.hash}`;
    return;
  }
  openConnect();
});

form.addEventListener("submit", async (e) => {
  const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
  if (submitter?.value !== "ok") return;
  e.preventDefault();
  const url = (form.elements.namedItem("url") as HTMLInputElement).value.trim().replace(/\/$/, "");
  const password = (form.elements.namedItem("password") as HTMLInputElement).value;
  const live = new LiveApi(url);
  try {
    await live.login(password);
  } catch (err) {
    $("#connect-error").textContent =
      err instanceof ApiError ? err.message : `Could not reach ${url}. Is the master running and allowing this origin?`;
    return;
  }
  dialog.close();
  const sameOrigin = url === location.origin;
  if (sameOrigin && api instanceof LiveApi) {
    await boot(live);
  } else {
    location.href = `${location.pathname}${sameOrigin ? "" : `?api=${encodeURIComponent(url)}`}${location.hash}`;
  }
});

// ------------------------------------------------------------------ boot

async function boot(chosen: FleetApi): Promise<void> {
  api = chosen;
  ctx.api = chosen;
  ctx.history = (chosen.seedHistory?.() ?? []).slice(-HISTORY) as Sample[];
  renderMode();
  if (chosen instanceof LiveApi && !chosen.authenticated) {
    mountRoute();
    openConnect(chosen.baseUrl, "Log in with the master's admin password.");
    return;
  }
  await ctx.refresh();
  mountRoute();
  startPolling();
}

window.addEventListener("hashchange", mountRoute);
window.addEventListener("resize", () => current?.update(ctx));
window.addEventListener("lapis:theme", () => current?.update(ctx));

void chooseApi().then(boot);
