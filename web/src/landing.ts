import "./styles/glass.css";
import "./styles/landing.css";
import "./styles/liquid.css";

import { DemoFleet } from "./lib/demo-fleet";
import { gib, percent } from "./lib/format";
import { MODEL_PRESETS, PROFILES, profile } from "./lib/hardware";
import { breakdown, isQuant, suggestQuant, verdict, type Quant } from "./lib/sizing";
import { sparkline } from "./ui/chart";
import { $, $$, addCopyButtons, hydrateIcons, hydrateRepoLinks } from "./ui/dom";
import { platformIcon } from "./ui/icons";
import { bindThemeToggles, initTheme } from "./ui/theme";

initTheme();
hydrateIcons();
hydrateRepoLinks();
bindThemeToggles();
addCopyButtons();

// ------------------------------------------------------------------ mobile nav

const menuBtn = $<HTMLButtonElement>(".nav__menu");
const links = $("#nav-links");
menuBtn.addEventListener("click", () => {
  const open = links.classList.toggle("is-open");
  menuBtn.setAttribute("aria-expanded", String(open));
});
$$("a", links).forEach((a) =>
  a.addEventListener("click", () => {
    links.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");
  }),
);

// ------------------------------------------------------------------ code tabs

$$<HTMLButtonElement>(".code-tabs__bar [role=tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const bar = tab.parentElement!;
    $$<HTMLButtonElement>("[role=tab]", bar).forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    $$<HTMLElement>(".code-tabs__panel", bar.parentElement!).forEach((p) => {
      p.hidden = p.dataset.panel !== tab.dataset.tab;
    });
  });
});

// ------------------------------------------------------------------ calculator

const modelSel = $<HTMLSelectElement>("#calc-model");
const paramsIn = $<HTMLInputElement>("#calc-params");
const paramsOut = $<HTMLOutputElement>("#calc-params-out");
const quantSel = $<HTMLSelectElement>("#calc-quant");
const ctxSel = $<HTMLSelectElement>("#calc-context");
const hwHost = $("#calc-hw");

modelSel.innerHTML =
  MODEL_PRESETS.map((p) => `<option value="${p.paramsB}" ${p.paramsB === 8 ? "selected" : ""}>${p.label}</option>`).join("") +
  `<option value="custom">Custom size…</option>`;

hwHost.innerHTML = PROFILES.map(
  (p, i) => `
  <div class="hw-option">
    <input type="radio" name="hw" id="hw-${p.id}" value="${p.id}" ${i === 0 ? "checked" : ""} />
    <label for="hw-${p.id}"><strong>${p.label}</strong><small>${p.example}</small></label>
  </div>`,
).join("");

$("#hw-cards").innerHTML = PROFILES.map(
  (p) => `
  <li class="hw-card glass">
    ${platformIcon(p.platform)}
    <h3>${p.label}</h3>
    <p>${p.example}</p>
    <strong>${p.sweetSpot}</strong>
  </li>`,
).join("");

function selectedProfileId(): string {
  return $<HTMLInputElement>("input[name=hw]:checked", hwHost).value;
}

function renderCalc(): void {
  const paramsB = Number(paramsIn.value);
  const quant: Quant = isQuant(quantSel.value) ? quantSel.value : "q4";
  const context = Number(ctxSel.value);
  const hw = profile(selectedProfileId());
  const usable = hw.memoryGib - hw.baseUsedGib;
  const b = breakdown(paramsB, quant, context);
  const v = verdict(b.total, usable);

  paramsOut.textContent = `${paramsB.toFixed(paramsB < 10 ? 1 : 0)}B`;
  $("#calc-needed").textContent = gib(b.total);
  const pill = $("#calc-verdict");
  pill.className = `pill pill--${v}`;
  pill.textContent = v === "comfortable" ? "Runs comfortably" : v === "tight" ? "Tight fit" : "Won't fit";

  const scale = Math.max(b.total, usable) * 1.08;
  const segs = $$<HTMLElement>(".seg", $("#calc-bar"));
  segs[0].style.width = `${percent(b.weights, scale)}%`;
  segs[1].style.width = `${percent(b.kvCache, scale)}%`;
  segs[2].style.width = `${percent(b.overhead, scale)}%`;
  $<HTMLElement>(".stack-bar__limit").style.left = `${percent(usable, scale)}%`;
  $("#calc-bar").setAttribute(
    "aria-label",
    `Needs ${b.total} GiB of ${usable.toFixed(1)} GiB available`,
  );

  $("#calc-w").textContent = gib(b.weights, 2);
  $("#calc-kv").textContent = gib(b.kvCache, 2);
  $("#calc-o").textContent = gib(b.overhead, 2);
  $("#calc-mem").textContent = `${gib(usable)} free`;

  const best = suggestQuant(paramsB, context, usable);
  const note = $("#calc-note");
  if (v === "comfortable") {
    note.textContent = `Leaves ${gib(usable - b.total)} for the desktop and a second small model.`;
  } else if (best) {
    note.textContent = `Try ${best.toUpperCase()} on this machine, or a shorter context window.`;
  } else {
    const bigger = PROFILES.find((p) => verdict(b.total, p.memoryGib - p.baseUsedGib) === "comfortable");
    note.textContent = bigger
      ? `Too big for this machine at any quantisation. ${bigger.label} hardware (${bigger.example}) would run it.`
      : "Too big for any single machine here. Pick a smaller model.";
  }
}

modelSel.addEventListener("change", () => {
  if (modelSel.value !== "custom") paramsIn.value = modelSel.value;
  renderCalc();
});
paramsIn.addEventListener("input", () => {
  const match = MODEL_PRESETS.find((p) => Math.abs(p.paramsB - Number(paramsIn.value)) < 0.05);
  modelSel.value = match ? String(match.paramsB) : "custom";
  renderCalc();
});
[quantSel, ctxSel].forEach((el) => el.addEventListener("change", renderCalc));
hwHost.addEventListener("change", renderCalc);
renderCalc();

// ------------------------------------------------------------------ hero: live demo fleet

const fleet = new DemoFleet({ seed: 42 });
const spark = $<HTMLCanvasElement>("#hero-spark");
const nodeList = $("#hero-node-list");

function renderHero(): void {
  const { kpis, nodes } = fleet.overview();
  $("#hero-tps").textContent = Math.round(kpis.tokens_per_second).toLocaleString();
  $("#hero-nodes").textContent = `${kpis.nodes_online}`;
  $("#hero-models").textContent = `${kpis.models_running}`;
  nodeList.innerHTML = nodes
    .filter((n) => n.telemetry)
    .map((n) => {
      const t = n.telemetry!;
      const used = percent(t.memory_used_gib, t.memory_total_gib);
      return `<li>
        ${platformIcon(n.platform)}
        <span>${n.name} <span class="muted">· ${n.models.length} model${n.models.length === 1 ? "" : "s"}</span></span>
        <span class="mono muted">${t.memory_used_gib.toFixed(1)}/${t.memory_total_gib} GiB</span>
        <div class="meter ${used > 90 ? "meter--warn" : ""}"><span style="width:${used}%"></span></div>
      </li>`;
    })
    .join("");
  sparkline(spark, fleet.history.slice(-60).map((s) => s.total));
}

renderHero();
let timer = window.setInterval(() => {
  fleet.tick();
  renderHero();
}, 1000);

document.addEventListener("visibilitychange", () => {
  window.clearInterval(timer);
  if (!document.hidden) {
    timer = window.setInterval(() => {
      fleet.tick();
      renderHero();
    }, 1000);
  }
});
window.addEventListener("resize", renderHero);
window.addEventListener("lapis:theme", renderHero);
