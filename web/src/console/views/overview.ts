import { avgUtil, compact, esc, gib, percent } from "../../lib/format";
import { cssVar, seriesColors, sparkline, stackedArea } from "../../ui/chart";
import { icon, platformIcon } from "../../ui/icons";
import type { View } from "../context";

let root: HTMLElement;

export const overviewView: View = {
  title: "Overview",
  subtitle: (ctx) =>
    `${ctx.data.kpis.nodes_online} machines · ${ctx.data.kpis.models_running} models serving · ${ctx.api.label}`,

  mount(el, ctx) {
    root = el;
    el.innerHTML = `
      <section class="kpis" aria-label="Fleet KPIs">
        <article class="kpi glass kpi--hero">
          <div class="kpi__top"><span class="label">Generation</span><span class="kpi__icon">${icon("bolt")}</span></div>
          <strong id="k-tps">0</strong>
          <canvas id="k-spark" aria-hidden="true"></canvas>
        </article>
        <article class="kpi glass">
          <div class="kpi__top"><span class="label">Nodes online</span><span class="kpi__icon">${icon("nodes")}</span></div>
          <strong id="k-nodes">0</strong>
          <span class="muted" id="k-nodes-sub"></span>
        </article>
        <article class="kpi glass">
          <div class="kpi__top"><span class="label">Models serving</span><span class="kpi__icon">${icon("models")}</span></div>
          <strong id="k-models">0</strong>
          <span class="muted" id="k-models-sub"></span>
        </article>
        <article class="kpi glass">
          <div class="kpi__top"><span class="label">Free memory</span><span class="kpi__icon">${icon("memory")}</span></div>
          <strong id="k-mem">0</strong>
          <div class="meter"><span id="k-mem-bar"></span></div>
        </article>
      </section>

      <section class="grid-2">
        <article class="card glass">
          <header class="card__head">
            <div><h2>Throughput by node</h2><p class="muted">Tokens per second, last two minutes</p></div>
            <span class="pill pill--online">live</span>
          </header>
          <canvas class="chart" id="o-chart" role="img" aria-label="Throughput chart"></canvas>
          <div class="legend" id="o-legend"></div>
        </article>
        <article class="card glass">
          <header class="card__head"><div><h2>Node headroom</h2><p class="muted">Accelerator memory in use</p></div></header>
          <div class="headroom" id="o-headroom"></div>
        </article>
      </section>

      <article class="card glass">
        <header class="card__head">
          <div><h2>Model leaderboard</h2><p class="muted">By tokens generated since the master started</p></div>
          <a class="btn btn--sm" href="#/models">Manage models ${icon("arrow")}</a>
        </header>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>#</th><th>Model</th><th>Node</th><th>Runtime</th><th class="num">Requests</th><th>Share of tokens</th><th class="num">Tokens</th><th class="num">Memory</th></tr></thead>
            <tbody id="o-board"></tbody>
          </table>
        </div>
      </article>`;
    this.update(ctx);
  },

  update(ctx) {
    if (!root?.isConnected) return;
    const { kpis, nodes, models } = ctx.data;
    const q = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;

    q("k-tps").innerHTML = `${Math.round(kpis.tokens_per_second).toLocaleString()} <small>tok/s</small>`;
    sparkline(q<HTMLCanvasElement>("k-spark"), ctx.history.slice(-60).map((s) => s.total), cssVar("--ink-text"));
    q("k-nodes").innerHTML = `${kpis.nodes_online}<small> / ${kpis.nodes_total}</small>`;
    q("k-nodes-sub").textContent = kpis.nodes_pending
      ? `${kpis.nodes_pending} waiting for approval`
      : "all machines approved";
    q("k-models").innerHTML = `${kpis.models_running}<small> / ${kpis.models_total}</small>`;
    q("k-models-sub").textContent = `${compact(kpis.requests_total)} requests · ${compact(kpis.tokens_total)} tokens`;
    q("k-mem").innerHTML = `${kpis.memory_free_gib.toFixed(0)}<small> of ${kpis.memory_total_gib.toFixed(0)} GiB</small>`;
    q("k-mem-bar").style.width = `${percent(kpis.memory_total_gib - kpis.memory_free_gib, kpis.memory_total_gib)}%`;

    const live = nodes.filter((n) => n.telemetry && n.state !== "pending" && n.state !== "revoked");
    const palette = seriesColors();
    const series = live.map((n, i) => ({
      label: n.name,
      color: palette[i % palette.length],
      values: ctx.history.map((s) => s.perNode[n.name] ?? 0),
    }));
    stackedArea(q<HTMLCanvasElement>("o-chart"), series);
    q("o-legend").innerHTML = series
      .map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`)
      .join("");

    q("o-headroom").innerHTML = live
      .map((n) => {
        const t = n.telemetry!;
        const used = percent(t.memory_used_gib, t.memory_total_gib);
        const cls = used > 92 ? "meter--bad" : used > 80 ? "meter--warn" : "";
        return `<div class="headroom__row">
          <span class="headroom__name">${platformIcon(n.platform)}${esc(n.name)}
            <span class="pill pill--${n.state}">${n.state}</span></span>
          <span class="mono muted">${t.memory_used_gib.toFixed(1)} / ${t.memory_total_gib} GiB</span>
          <div class="meter ${cls}"><span style="width:${used}%"></span></div>
          <small class="muted">${esc(t.accelerator)} · ${t.tokens_per_second.toFixed(0)} tok/s · ${t.gpus.length ? `${avgUtil(t.gpus)!.toFixed(0)}% util${t.gpus.length > 1 ? ` (avg of ${t.gpus.length} GPUs)` : ""}` : "unified memory"}</small>
        </div>`;
      })
      .join("") || `<p class="empty">No machines online yet.</p>`;

    const ranked = [...models].filter((m) => m.tokens > 0 || m.state === "running").sort((a, b) => b.tokens - a.tokens);
    const top = Math.max(1, ...ranked.map((m) => m.tokens));
    const total = ranked.reduce((s, m) => s + m.tokens, 0) || 1;
    q("o-board").innerHTML =
      ranked
        .map(
          (m, i) => `<tr>
          <td><span class="rank">${i + 1}</span></td>
          <td class="mono">${esc(m.spec.name)}</td>
          <td>${esc(m.node_name ?? "–")}</td>
          <td><span class="tag">${esc(m.spec.runtime)}</span></td>
          <td class="num">${m.requests.toLocaleString()}</td>
          <td class="bar-cell"><div class="meter"><span style="width:${percent(m.tokens, top)}%"></span></div>
            <small class="muted">${((m.tokens / total) * 100).toFixed(1)}%</small></td>
          <td class="num">${compact(m.tokens)}</td>
          <td class="num">${gib(m.budget_gib)}</td>
        </tr>`,
        )
        .join("") || `<tr><td colspan="8" class="empty">No traffic yet.</td></tr>`;
  },
};
