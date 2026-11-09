import { ago, esc } from "../../lib/format";
import type { ApiKeyView, Scope } from "../../lib/types";
import { addCopyButtons, copyText, toast } from "../../ui/dom";
import { icon } from "../../ui/icons";
import type { Ctx, View } from "../context";

let root: HTMLElement;

async function renderKeys(ctx: Ctx): Promise<void> {
  let keys: ApiKeyView[] = [];
  try {
    keys = await ctx.api.keys();
  } catch (err) {
    toast((err as Error).message, "bad");
  }
  const tbody = root.querySelector("#a-keys");
  if (!tbody) return;
  tbody.innerHTML =
    keys
      .map(
        (k) => `<tr data-key="${esc(k.id)}">
        <td><strong>${esc(k.name)}</strong></td>
        <td class="mono">${esc(k.prefix)}…</td>
        <td>${k.scopes.map((s) => `<span class="tag">${esc(s)}</span>`).join(" ")}</td>
        <td>${ago(k.created_at)}</td>
        <td>${ago(k.last_used_at)}</td>
        <td class="num"><button class="btn btn--sm btn--ghost btn--danger" data-revoke>${icon("trash")}Revoke</button></td>
      </tr>`,
      )
      .join("") || `<tr><td colspan="6" class="empty">No keys yet. Create one per person or app.</td></tr>`;
}

function snippets(base: string): string {
  return `
    <article class="card glass">
      <header class="card__head"><div><h2>Connect a client</h2><p class="muted">Anything that speaks the OpenAI API works. Use a key from above.</p></div></header>
      <dl class="kv" style="margin-bottom:16px"><dt>Base URL</dt><dd class="mono">${esc(base)}/v1</dd></dl>
      <div class="grid-2" style="grid-template-columns:1fr 1fr">
        <div><span class="label">Shell</span>
<pre class="code" style="margin-top:8px;font-size:12px">export OPENAI_BASE_URL=${esc(base)}/v1
export OPENAI_API_KEY=lap_...</pre></div>
        <div><span class="label">VS Code · Continue (config.yaml)</span>
<pre class="code" style="margin-top:8px;font-size:12px">models:
  - name: Lapis coder
    provider: openai
    model: qwen2.5-coder-14b
    apiBase: ${esc(base)}/v1
    apiKey: lap_...</pre></div>
      </div>
    </article>`;
}

export const accessView: View = {
  title: "Access",
  subtitle: () => "API keys for /v1 and /metrics. Keys are hashed on the master and shown exactly once.",

  mount(el, ctx) {
    root = el;
    el.innerHTML = `
      <article class="card glass">
        <header class="card__head"><div><h2>Create an API key</h2><p class="muted">Give every person, agent or dashboard its own key so you can revoke one without the others.</p></div></header>
        <form class="inline-form" id="a-form">
          <input class="input" name="name" placeholder="e.g. vscode-laptop" required maxlength="64" aria-label="Key name" />
          <label class="check"><input type="checkbox" name="inference" checked /> inference</label>
          <label class="check"><input type="checkbox" name="metrics" /> metrics</label>
          <button class="btn btn--primary">${icon("key")}Create key</button>
        </form>
        <div id="a-secret" style="margin-top:14px"></div>
      </article>
      <article class="card glass">
        <header class="card__head"><div><h2>Keys</h2></div></header>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Created</th><th>Last used</th><th></th></tr></thead>
          <tbody id="a-keys"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
        </table></div>
      </article>
      ${snippets(ctx.api.baseUrl)}`;
    addCopyButtons(el);

    el.querySelector<HTMLFormElement>("#a-form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
      const scopes = (["inference", "metrics"] as Scope[]).filter(
        (s) => (form.elements.namedItem(s) as HTMLInputElement).checked,
      );
      if (!scopes.length) {
        toast("Pick at least one scope", "bad");
        return;
      }
      const created = await ctx.act(() => ctx.api.createKey(name, scopes));
      if (!created) return;
      form.reset();
      const box = el.querySelector("#a-secret")!;
      box.innerHTML = `<div class="secret">
        <strong>${icon("check")} Key for ${esc(created.name)} created. Copy it now: it won't be shown again.</strong>
        <code class="mono" id="a-secret-value">${esc(created.key)}</code>
        <div><button class="btn btn--sm" type="button" id="a-copy">${icon("copy")}Copy key</button></div>
      </div>`;
      box.querySelector("#a-copy")!.addEventListener("click", async () => {
        toast((await copyText(created.key)) ? "Copied to clipboard" : "Copy failed: select the key and copy it manually", "ok");
      });
      await renderKeys(ctx);
    });

    el.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-revoke]");
      const tr = btn?.closest<HTMLElement>("[data-key]");
      if (!btn || !tr) return;
      if (!confirm("Revoke this key? Clients using it will get 403 immediately.")) return;
      await ctx.act(() => ctx.api.revokeKey(tr.dataset.key!), "Key revoked");
      await renderKeys(ctx);
    });
    void renderKeys(ctx);
  },

  update() {
    /* keys only change through this page */
  },
};
