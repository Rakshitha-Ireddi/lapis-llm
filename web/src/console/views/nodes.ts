import { ago, avgUtil, esc, percent } from "../../lib/format";
import type { NodeView } from "../../lib/types";
import { addCopyButtons } from "../../ui/dom";
import { icon, platformIcon } from "../../ui/icons";
import { button, type View } from "../context";

let root: HTMLElement;
let pendingSignature = "";

function memoryBars(n: NodeView): string {
  const t = n.telemetry;
  if (!t) return `<p class="muted">No telemetry yet.</p>`;
  const rows = t.gpus.length && !t.unified_memory
    ? t.gpus.map((g) => ({ label: `GPU ${g.index} · ${g.name}`, used: g.memory_used_gib, total: g.memory_total_gib }))
    : [{ label: `${t.accelerator} · unified`, used: t.memory_used_gib, total: t.memory_total_gib }];
  return rows
    .map((r) => {
      const p = percent(r.used, r.total);
      return `<div class="headroom__row">
        <small class="muted">${esc(r.label)}</small>
        <small class="mono">${r.used.toFixed(1)} / ${r.total} GiB</small>
        <div class="meter ${p > 92 ? "meter--bad" : p > 80 ? "meter--warn" : ""}"><span style="width:${p}%"></span></div>
      </div>`;
    })
    .join("");
}

function nodeCard(n: NodeView): string {
  const t = n.telemetry;
  const id = esc(n.id);
  const actions =
    n.state === "draining"
      ? `<button class="btn btn--sm" data-action="undrain">${icon("play")}Resume</button>`
      : n.state === "online"
        ? `<button class="btn btn--sm" data-action="drain">${icon("stop")}Drain</button>`
        : "";
  return `<article class="node-card glass" data-node="${id}">
    <header class="node-card__head">
      <div class="node-card__title">
        <span class="os-badge">${platformIcon(n.platform)}</span>
        <div><h3>${esc(n.name)}</h3><small class="mono">${esc(n.url)}</small></div>
      </div>
      <span class="pill pill--${n.state}">${n.state}</span>
    </header>
    ${memoryBars(n)}
    <div class="stats">
      <div><strong>${t ? t.tokens_per_second.toFixed(0) : "–"}</strong><span>tok/s</span></div>
      <div><strong>${t && t.gpus.length ? `${avgUtil(t.gpus)!.toFixed(0)}%` : "–"}</strong><span>${t && t.gpus.length > 1 ? "avg GPU util" : "GPU util"}</span></div>
      <div><strong>${t ? `${Math.round(t.disk_free_gib)}` : "–"}</strong><span>GiB disk free</span></div>
    </div>
    <div class="chips">
      ${n.runtimes.map((r) => `<span class="tag">${esc(r)}</span>`).join("")}
      ${n.models.map((m) => `<span class="chip">${icon("models")}${esc(m)}</span>`).join("")}
    </div>
    <footer class="node-card__foot">
      ${actions}
      ${n.state !== "revoked" ? `<button class="btn btn--sm btn--ghost btn--danger" data-action="revoke">${icon("shield")}Revoke</button>` : `<button class="btn btn--sm btn--ghost btn--danger" data-action="remove">${icon("trash")}Remove</button>`}
      <small class="muted" style="margin-left:auto;align-self:center">seen ${ago(n.last_seen)}</small>
    </footer>
  </article>`;
}

function pendingCard(n: NodeView): string {
  return `<article class="node-card glass pending" data-node="${esc(n.id)}">
    <header class="node-card__head">
      <div class="node-card__title">
        <span class="os-badge">${platformIcon(n.platform)}</span>
        <div><h3>${esc(n.name)}</h3><small class="mono">${esc(n.url)} · asked ${ago(n.created_at)}</small></div>
      </div>
      <span class="pill pill--pending">pending</span>
    </header>
    <div>
      <span class="label">Fingerprint reported by the agent</span>
      <code class="fp">${esc(n.fingerprint)}</code>
    </div>
    <form class="approve-form" data-approve="${esc(n.id)}">
      <input class="input mono" name="fp" placeholder="Paste the fingerprint printed on the machine" aria-label="Fingerprint for ${esc(n.name)}" required />
      <button class="btn btn--primary">${icon("check")}Approve</button>
    </form>
    <small class="muted">Compare it with the agent's terminal output. Only approve if they match exactly.</small>
    <footer class="node-card__foot">
      <button class="btn btn--sm btn--ghost btn--danger" data-action="remove">${icon("trash")}Reject</button>
    </footer>
  </article>`;
}

export const nodesView: View = {
  title: "Nodes",
  subtitle: (ctx) => {
    const k = ctx.data.kpis;
    return `${k.nodes_online} online${k.nodes_pending ? ` · ${k.nodes_pending} awaiting approval` : ""} · ${k.memory_total_gib.toFixed(0)} GiB of model memory`;
  },

  actions() {
    const add = button("Add a machine", icon("plus"), "btn btn--primary");
    add.addEventListener("click", () => root.querySelector("#join")?.scrollIntoView({ behavior: "smooth" }));
    return [add];
  },

  mount(el, ctx) {
    root = el;
    pendingSignature = "";
    el.innerHTML = `
      <section id="n-pending" class="nodes-grid" aria-label="Pending approvals"></section>
      <section id="n-grid" class="nodes-grid" aria-label="Machines"></section>
      <article class="card glass join" id="join">
        <div>
          <h2>Add a machine</h2>
          <p>Run the agent on the new machine. It prints a fingerprint and appears here as <em>pending</em>. Approve it once the fingerprints match.</p>
          <p class="muted">Windows needs an NVIDIA GPU and <code>llama-server</code>. Macs need Apple Silicon. Linux nodes can use vLLM or llama.cpp.</p>
        </div>
        <pre class="code"><span class="p">$</span> pip install lapis-llm
<span class="p">$</span> lapis agent --master ${esc(ctx.api.baseUrl)} \\
    --name $(hostname)</pre>
      </article>`;
    addCopyButtons(el);

    el.addEventListener("submit", async (e) => {
      const form = (e.target as HTMLElement).closest<HTMLFormElement>("[data-approve]");
      if (!form) return;
      e.preventDefault();
      const id = form.dataset.approve!;
      const fp = (form.elements.namedItem("fp") as HTMLInputElement).value;
      const ok = await ctx.act(() => ctx.api.approve(id, fp), "Machine approved. It can now serve models.");
      if (ok) pendingSignature = "";
      this.update(ctx);
    });

    el.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
      const card = btn?.closest<HTMLElement>("[data-node]");
      if (!btn || !card) return;
      const id = card.dataset.node!;
      const node = ctx.data.nodes.find((n) => n.id === id);
      if (!node) return;
      switch (btn.dataset.action) {
        case "drain":
          await ctx.act(() => ctx.api.drain(id), `${node.name} is draining: no new models will be placed there`);
          break;
        case "undrain":
          await ctx.act(() => ctx.api.undrain(id), `${node.name} accepts models again`);
          break;
        case "revoke":
          if (confirm(`Revoke ${node.name}? Its secret is invalidated and its models stop being routed.`)) {
            await ctx.act(() => ctx.api.revoke(id), `${node.name} revoked`);
          }
          break;
        case "remove":
          await ctx.act(() => ctx.api.removeNode(id), `${node.name} removed`);
          pendingSignature = "";
          break;
      }
      this.update(ctx);
    });
    this.update(ctx);
  },

  update(ctx) {
    if (!root?.isConnected) return;
    const pending = ctx.data.nodes.filter((n) => n.state === "pending");
    const signature = pending.map((n) => n.id).join(",");
    if (signature !== pendingSignature) {
      // Only re-render approvals when the set changes, so typing isn't interrupted.
      root.querySelector("#n-pending")!.innerHTML = pending.map(pendingCard).join("");
      pendingSignature = signature;
    }
    const rank = { online: 0, draining: 1, offline: 2, revoked: 3, pending: 4 } as const;
    const others = ctx.data.nodes
      .filter((n) => n.state !== "pending")
      .sort((a, b) => rank[a.state] - rank[b.state] || (b.telemetry?.memory_total_gib ?? 0) - (a.telemetry?.memory_total_gib ?? 0));
    root.querySelector("#n-grid")!.innerHTML = others.map(nodeCard).join("") || `<p class="empty glass">No machines yet.</p>`;
  },
};
