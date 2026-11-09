import { esc } from "../../lib/format";
import type { AuditEntry } from "../../lib/types";
import type { Ctx, View } from "../context";

let root: HTMLElement;
let busy = false;

function time(at: number): string {
  return new Date(at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function render(ctx: Ctx): Promise<void> {
  if (busy) return;
  busy = true;
  let entries: AuditEntry[] = [];
  try {
    entries = await ctx.api.audit();
  } finally {
    busy = false;
  }
  const list = root?.querySelector("#au-list");
  if (!list) return;
  list.innerHTML =
    entries
      .map(
        (e) => `<li>
        <span class="mono muted">${time(e.at)}</span>
        <span class="action">${esc(e.action)}</span>
        <span><strong>${esc(e.actor)}</strong>${e.target ? ` → ${esc(e.target)}` : ""}${e.detail ? ` <span class="muted">· ${esc(e.detail)}</span>` : ""}</span>
      </li>`,
      )
      .join("") || `<li class="empty">Nothing recorded yet.</li>`;
}

export const auditView: View = {
  title: "Audit log",
  subtitle: () => "Every admin, agent and reconciler action, newest first",

  mount(el, ctx) {
    root = el;
    el.innerHTML = `<article class="card glass"><ul class="timeline" id="au-list"></ul></article>`;
    void render(ctx);
  },

  update(ctx) {
    if (root?.isConnected) void render(ctx);
  },
};
