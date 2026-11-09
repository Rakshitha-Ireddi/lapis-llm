/** DOM helpers shared by the site and the console. */

import { REPO_URL } from "../config";
import { LOGO, icon } from "./icons";

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`missing element ${selector}`);
  return el;
}

export function $$<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/** Replace `<span data-icon="x">` placeholders and `[data-logo]` brand marks. */
export function hydrateIcons(root: ParentNode = document): void {
  $$<HTMLElement>("[data-icon]", root).forEach((el) => {
    if (el.dataset.hydrated) return;
    el.innerHTML = icon(el.dataset.icon ?? "");
    el.dataset.hydrated = "1";
  });
  $$<HTMLElement>("[data-logo]", root).forEach((el) => {
    if (el.dataset.hydrated) return;
    el.innerHTML = `${LOGO}<span>Lapis<b>LLM</b></span>`;
    el.dataset.hydrated = "1";
  });
}

export function hydrateRepoLinks(root: ParentNode = document): void {
  $$<HTMLAnchorElement>("[data-repo-link]", root).forEach((a) => {
    a.href = REPO_URL + (a.dataset.repoPath ?? "");
    a.rel = "noopener";
  });
  $$<HTMLElement>("[data-repo-text]", root).forEach((el) => (el.textContent = REPO_URL));
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Add a copy button to every `pre.code` inside root. */
export function addCopyButtons(root: ParentNode = document): void {
  $$<HTMLPreElement>("pre.code", root).forEach((pre) => {
    if (pre.dataset.copy === "off" || pre.querySelector(".copy-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--sm btn--ghost copy-btn";
    btn.setAttribute("aria-label", "Copy code");
    btn.innerHTML = icon("copy");
    btn.addEventListener("click", async () => {
      const text = Array.from(pre.childNodes)
        .filter((n) => n !== btn)
        .map((n) => n.textContent ?? "")
        .join("")
        .split("\n")
        .map((line) => line.replace(/^\s*[$%>]\s|^PS>\s/, ""))
        .join("\n")
        .trim();
      const ok = await copyText(text);
      btn.innerHTML = icon(ok ? "check" : "x");
      setTimeout(() => (btn.innerHTML = icon("copy")), 1400);
    });
    pre.appendChild(btn);
  });
}

let toastHost: HTMLElement | null = null;

export function toast(message: string, kind: "ok" | "bad" = "ok"): void {
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "toasts";
    toastHost.setAttribute("role", "status");
    toastHost.setAttribute("aria-live", "polite");
    document.body.appendChild(toastHost);
  }
  const el = document.createElement("div");
  el.className = `toast glass glass--strong toast--${kind}`;
  el.textContent = message;
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), kind === "bad" ? 6000 : 3200);
}
