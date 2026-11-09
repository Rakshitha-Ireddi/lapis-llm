import { esc, gib, slugify } from "../../lib/format";
import { isQuant } from "../../lib/sizing";
import type { ModelSpec, ModelView, RuntimeKind } from "../../lib/types";
import { hydrateIcons } from "../../ui/dom";
import { icon } from "../../ui/icons";
import type { Preview } from "../api";
import { button, type Ctx, type View } from "../context";

let root: HTMLElement;

function row(m: ModelView): string {
  const running = m.state === "running" || m.state === "starting";
  const name = esc(m.spec.name);
  return `<tr data-model="${name}">
    <td><div class="model-name"><strong>${name}</strong><small>${esc(m.spec.source || "–")}</small></div></td>
    <td><span class="tag">${esc(m.spec.runtime)}</span></td>
    <td class="mono">${m.spec.params_b}B · ${m.spec.quant} · ${(m.spec.context / 1024).toFixed(0)}k</td>
    <td class="num">${gib(m.budget_gib, 2)}</td>
    <td class="nowrap">${esc(m.node_name ?? "–")}</td>
    <td><span class="pill pill--${m.state}">${m.state}</span>
      ${m.last_error ? `<span class="error-line">${esc(m.last_error)}</span>` : ""}</td>
    <td><div class="row-actions">
      ${
        running
          ? `<button class="btn btn--sm" data-action="stop">${icon("stop")}Stop</button>`
          : `<button class="btn btn--sm btn--primary" data-action="start">${icon("play")}Start</button>`
      }
      <button class="btn btn--sm" data-action="move" ${m.node_id || running ? "" : "disabled"}>${icon("move")}Move</button>
      <button class="btn btn--sm btn--ghost btn--danger btn--icon" data-action="remove" aria-label="Remove ${name}" ${running ? "disabled" : ""}>${icon("trash")}</button>
    </div></td>
  </tr>`;
}

function previewList(preview: Preview): string {
  return preview.nodes
    .map(
      (r) => `<li class="${r.chosen ? "chosen" : ""}">
        <span class="${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"}</span>
        <strong>${esc(r.node_name)}${r.chosen ? " ★" : ""}</strong>
        <span class="reason">${esc(r.reason)}</span>
      </li>`,
    )
    .join("");
}

function openAddDialog(ctx: Ctx): void {
  const dlg = document.createElement("dialog");
  dlg.className = "glass";
  dlg.setAttribute("aria-labelledby", "add-title");
  dlg.innerHTML = `
    <form method="dialog" class="dialog" id="add-form">
      <header class="dialog__head"><h2 id="add-title">Add a model</h2>
        <button class="btn btn--ghost btn--icon" value="cancel" formnovalidate aria-label="Close">${icon("x")}</button></header>
      <label class="field"><span>Hugging Face repo or GGUF path</span>
        <input class="input" name="source" placeholder="Qwen/Qwen2.5-7B-Instruct-GGUF" required /></label>
      <label class="field"><span>Model name (what clients send as <code>model</code>)</span>
        <input class="input" name="name" placeholder="qwen2.5-7b-instruct" required pattern="[a-z0-9][a-z0-9._:\\-]{0,63}" /></label>
      <div class="row">
        <label class="field"><span>Runtime</span>
          <select class="select" name="runtime">
            <option value="llama.cpp">llama.cpp</option><option value="vllm">vLLM</option>
            <option value="mlx">MLX</option><option value="simulated">simulated</option>
          </select></label>
        <label class="field"><span>Parameters (B)</span><input class="input" name="params_b" type="number" min="0.05" step="any" value="7.6" required /></label>
        <label class="field"><span>Quantisation</span>
          <select class="select" name="quant"><option>q4</option><option>q5</option><option>q6</option><option>q8</option><option>fp16</option></select></label>
      </div>
      <label class="field"><span>Context window</span>
        <select class="select" name="context"><option value="4096">4k</option><option value="8192" selected>8k</option>
        <option value="16384">16k</option><option value="32768">32k</option></select></label>
      <div class="budget"><span class="label">Memory budget</span><strong id="add-budget">–</strong></div>
      <div><span class="label">Placement preview</span><ul class="preview" id="add-preview"></ul></div>
      <p class="form-error" id="add-error" role="alert"></p>
      <footer class="dialog__foot">
        <button class="btn" value="cancel" formnovalidate>Cancel</button>
        <button class="btn" value="add" data-submit="add">Add</button>
        <button class="btn btn--primary" value="start" data-submit="start">${icon("play")}Add &amp; start</button>
      </footer>
    </form>`;
  document.body.appendChild(dlg);
  const form = dlg.querySelector<HTMLFormElement>("form")!;
  const f = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
  let nameTouched = false;
  let timer = 0;

  const spec = (): ModelSpec => ({
    name: f("name").value.trim() || "preview",
    source: f("source").value.trim(),
    runtime: f("runtime").value as RuntimeKind,
    params_b: Number(f("params_b").value) || 1,
    quant: isQuant(f("quant").value) ? f("quant").value as ModelSpec["quant"] : "q4",
    context: Number(f("context").value),
    parallel: 4,
    memory_gib: null,
  });

  const refreshPreview = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try {
        const preview = await ctx.api.preview(spec());
        dlg.querySelector("#add-budget")!.textContent = gib(preview.budget_gib, 2);
        dlg.querySelector("#add-preview")!.innerHTML = previewList(preview);
      } catch (err) {
        dlg.querySelector("#add-error")!.textContent = (err as Error).message;
      }
    }, 150);
  };

  f("name").addEventListener("input", () => (nameTouched = true));
  f("source").addEventListener("input", () => {
    if (!nameTouched) f("name").value = slugify(f("source").value.replace(/-gguf$/i, ""));
    const m = f("source").value.match(/(\d+(?:\.\d+)?)\s*[bB](?![a-z])/);
    if (m) f("params_b").value = m[1];
  });
  form.addEventListener("input", refreshPreview);
  form.addEventListener("submit", async (e) => {
    const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
    const mode = submitter?.dataset.submit;
    if (!mode) return;
    e.preventDefault();
    const s = spec();
    try {
      await ctx.api.addModel(s);
      if (mode === "start") await ctx.api.startModel(s.name);
      dlg.close();
      await ctx.refresh();
      const { toast } = await import("../../ui/dom");
      toast(mode === "start" ? `${s.name} added and started` : `${s.name} added`);
    } catch (err) {
      dlg.querySelector("#add-error")!.textContent = (err as Error).message;
      await ctx.refresh();
    }
  });
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();
  refreshPreview();
}

async function openMoveDialog(ctx: Ctx, model: ModelView): Promise<void> {
  const preview = await ctx.api.preview(model.spec);
  const dlg = document.createElement("dialog");
  dlg.className = "glass";
  dlg.innerHTML = `
    <form method="dialog" class="dialog">
      <header class="dialog__head"><h2>Move ${esc(model.spec.name)}</h2>
        <button class="btn btn--ghost btn--icon" value="cancel" aria-label="Close">${icon("x")}</button></header>
      <p class="muted">Currently on <strong>${esc(model.node_name ?? "no node")}</strong>. Pick a machine that has room:</p>
      <ul class="preview">${preview.nodes
        .filter((r) => r.node_id !== model.node_id)
        .map(
          (r) => `<li><span class="${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"}</span>
          <strong>${esc(r.node_name)}</strong>
          <span class="reason">${esc(r.reason)}
          ${r.ok ? `<br/><button class="btn btn--sm btn--primary" value="${esc(r.node_id)}" style="margin-top:8px">Move here</button>` : ""}</span></li>`,
        )
        .join("")}</ul>
    </form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener("close", async () => {
    const target = dlg.returnValue;
    dlg.remove();
    if (target && target !== "cancel") {
      await ctx.act(() => ctx.api.moveModel(model.spec.name, target), `${model.spec.name} moved`);
    }
  });
  dlg.showModal();
}

export const modelsView: View = {
  title: "Models",
  subtitle: (ctx) =>
    `${ctx.data.models.length} defined · ${ctx.data.kpis.models_running} running · every start passes a memory check first`,

  actions(ctx) {
    const add = button("Add model", icon("plus"), "btn btn--primary");
    add.addEventListener("click", () => openAddDialog(ctx));
    return [add];
  },

  mount(el, ctx) {
    root = el;
    el.innerHTML = `
      <article class="card glass">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Model</th><th>Runtime</th><th>Size</th><th class="num">Budget</th><th>Node</th><th>State</th><th class="num">Actions</th></tr></thead>
            <tbody id="m-rows"></tbody>
          </table>
        </div>
      </article>`;
    el.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
      const tr = btn?.closest<HTMLElement>("[data-model]");
      if (!btn || !tr) return;
      const name = tr.dataset.model!;
      const model = ctx.data.models.find((m) => m.spec.name === name);
      if (!model) return;
      btn.disabled = true;
      switch (btn.dataset.action) {
        case "start":
          await ctx.act(() => ctx.api.startModel(name), `${name} is running`);
          break;
        case "stop":
          await ctx.act(() => ctx.api.stopModel(name), `${name} stopped`);
          break;
        case "move":
          await openMoveDialog(ctx, model);
          break;
        case "remove":
          if (confirm(`Remove ${name}? Its definition is deleted; downloaded files stay on the node.`)) {
            await ctx.act(() => ctx.api.removeModel(name), `${name} removed`);
          }
          break;
      }
      btn.disabled = false;
    });
    this.update(ctx);
  },

  update(ctx) {
    if (!root?.isConnected) return;
    const order = { running: 0, starting: 1, failed: 2, stopped: 3 } as const;
    const models = [...ctx.data.models].sort(
      (a, b) => order[a.state] - order[b.state] || b.budget_gib - a.budget_gib,
    );
    const tbody = root.querySelector("#m-rows")!;
    tbody.innerHTML = models.map(row).join("") || `<tr><td colspan="7" class="empty">No models yet. Add one to get started.</td></tr>`;
    hydrateIcons(tbody);
  },
};
