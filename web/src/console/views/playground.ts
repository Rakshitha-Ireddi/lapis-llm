import { esc, gib } from "../../lib/format";
import type { ChatMessage } from "../../lib/types";
import { addCopyButtons } from "../../ui/dom";
import { icon } from "../../ui/icons";
import type { Ctx, View } from "../context";

let root: HTMLElement;
let history: ChatMessage[] = [];
let selected = "";
let modelSignature = "";
let abort: AbortController | null = null;

const SUGGESTIONS = [
  "Which machine answered this?",
  "Explain memory admission in two sentences.",
  "Write a haiku about a spare RTX 3070.",
];

function chatModels(ctx: Ctx) {
  return ctx.data.models.filter((m) => m.state === "running" && !m.spec.name.includes("embed"));
}

function renderModelOptions(ctx: Ctx): void {
  const select = root.querySelector<HTMLSelectElement>("#pg-model")!;
  const models = chatModels(ctx);
  const signature = models.map((m) => m.spec.name).join(",");
  if (signature === modelSignature) return;
  modelSignature = signature;
  if (!models.some((m) => m.spec.name === selected)) {
    selected = models.find((m) => m.spec.name.includes("coder"))?.spec.name ?? models[0]?.spec.name ?? "";
  }
  select.innerHTML = models.length
    ? models.map((m) => `<option ${m.spec.name === selected ? "selected" : ""}>${esc(m.spec.name)}</option>`).join("")
    : `<option value="">No running chat models</option>`;
}

function renderInfo(ctx: Ctx): void {
  const model = ctx.data.models.find((m) => m.spec.name === selected);
  const node = ctx.data.nodes.find((n) => n.id === model?.node_id);
  root.querySelector("#pg-info")!.innerHTML = model
    ? `<dt>Node</dt><dd>${esc(node?.name ?? "–")}</dd>
       <dt>Runtime</dt><dd>${esc(model.spec.runtime)}</dd>
       <dt>Size</dt><dd>${model.spec.params_b}B · ${model.spec.quant}</dd>
       <dt>Budget</dt><dd>${gib(model.budget_gib, 2)}</dd>
       <dt>Context</dt><dd>${model.spec.context.toLocaleString()} tokens</dd>
       <dt>Requests</dt><dd>${model.requests.toLocaleString()}</dd>`
    : `<dt>Model</dt><dd>none running</dd>`;
  const code = root.querySelector("#pg-code")!;
  code.innerHTML = `<span class="k">from</span> openai <span class="k">import</span> OpenAI
client = OpenAI(base_url=<span class="s">"${esc(ctx.api.baseUrl)}/v1"</span>,
                api_key=<span class="s">"lap_..."</span>)
client.chat.completions.create(
    model=<span class="s">"${esc(selected || "your-model")}"</span>,
    messages=[...])`;
  addCopyButtons(code.parentElement!);
}

function emptyState(): string {
  return `<div id="pg-empty" class="empty"><p>Pick a model and say hello. The reply streams from whichever machine is serving it.</p>
    <div class="suggestions">${SUGGESTIONS.map((s) => `<button class="chip" type="button" data-suggest="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`;
}

function bubble(msg: ChatMessage, meta = ""): string {
  return `<div class="msg msg--${msg.role}">${esc(msg.content)}${meta ? `<span class="msg__meta">${meta}</span>` : ""}</div>`;
}

async function send(ctx: Ctx, text: string): Promise<void> {
  if (!text.trim() || !selected || abort) return;
  const log = root.querySelector<HTMLElement>("#pg-log")!;
  root.querySelector("#pg-empty")?.remove();
  history.push({ role: "user", content: text.trim() });
  log.insertAdjacentHTML("beforeend", bubble(history[history.length - 1]));
  const out = document.createElement("div");
  out.className = "msg msg--assistant msg--typing";
  log.appendChild(out);
  log.scrollTop = log.scrollHeight;

  const sendBtn = root.querySelector<HTMLButtonElement>("#pg-send")!;
  sendBtn.innerHTML = `${icon("stop")}<span>Stop</span>`;
  abort = new AbortController();
  let content = "";
  try {
    const result = await ctx.api.chat(
      selected,
      history,
      (delta) => {
        content += delta;
        out.textContent = content;
        log.scrollTop = log.scrollHeight;
      },
      abort.signal,
    );
    history.push({ role: "assistant", content });
    const tps = result.tokens / Math.max(result.ms / 1000, 0.001);
    out.insertAdjacentHTML(
      "beforeend",
      `<span class="msg__meta">${esc(selected)} · routed to <strong>${esc(result.node)}</strong> · ${result.tokens} tokens · ${tps.toFixed(0)} tok/s</span>`,
    );
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      out.innerHTML = `<span class="bad">${esc((err as Error).message)}</span>`;
    }
  } finally {
    out.classList.remove("msg--typing");
    abort = null;
    sendBtn.innerHTML = `${icon("send")}<span>Send</span>`;
    void ctx.refresh();
  }
}

export const playgroundView: View = {
  title: "Playground",
  subtitle: () => "Chat with any running model through the same /v1 endpoint your apps use",

  mount(el, ctx) {
    root = el;
    modelSignature = "";
    el.innerHTML = `
      <div class="playground">
        <section class="chat glass" aria-label="Chat">
          <div class="chat__log" id="pg-log" aria-live="polite">
            ${history.length ? history.map((m) => bubble(m)).join("") : emptyState()}
          </div>
          <form class="chat__input" id="pg-form">
            <textarea class="textarea" id="pg-text" rows="1" placeholder="Message the fleet…" aria-label="Message"></textarea>
            <button class="btn btn--primary" id="pg-send">${icon("send")}<span>Send</span></button>
          </form>
        </section>
        <aside class="side-panel">
          <article class="card glass">
            <label class="field"><span>Model</span><select class="select" id="pg-model"></select></label>
            <dl class="kv" id="pg-info" style="margin-top:16px"></dl>
            <button class="btn btn--sm btn--ghost" id="pg-clear" type="button" style="margin-top:14px">${icon("refresh")}New conversation</button>
          </article>
          <article class="card glass">
            <span class="label">Use it from code</span>
            <div style="position:relative;margin-top:10px"><pre class="code" id="pg-code" style="font-size:12px"></pre></div>
          </article>
        </aside>
      </div>`;

    const text = el.querySelector<HTMLTextAreaElement>("#pg-text")!;
    el.querySelector("#pg-form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      if (abort) {
        abort.abort();
        return;
      }
      const value = text.value;
      text.value = "";
      void send(ctx, value);
    });
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        el.querySelector<HTMLFormElement>("#pg-form")!.requestSubmit();
      }
    });
    el.querySelector("#pg-model")!.addEventListener("change", (e) => {
      selected = (e.target as HTMLSelectElement).value;
      renderInfo(ctx);
    });
    el.querySelector("#pg-clear")!.addEventListener("click", () => {
      abort?.abort();
      history = [];
      el.querySelector("#pg-log")!.innerHTML = emptyState();
    });
    el.addEventListener("click", (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-suggest]");
      if (chip) void send(ctx, chip.dataset.suggest!);
    });
    this.update(ctx);
  },

  update(ctx) {
    if (!root?.isConnected) return;
    renderModelOptions(ctx);
    renderInfo(ctx);
  },

  unmount() {
    abort?.abort();
  },
};
