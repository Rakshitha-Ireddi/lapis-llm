/** Light / dark / system theme, remembered per browser. */

export type Theme = "light" | "dark";
const KEY = "lapis-theme";

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: theme just won't persist */
  }
  window.dispatchEvent(new CustomEvent("lapis:theme", { detail: theme }));
}

export function initTheme(): void {
  const params = new URLSearchParams(location.search);
  const forced = params.get("theme");
  const theme = forced === "light" || forced === "dark" ? forced : stored();
  if (theme) document.documentElement.dataset.theme = theme;
}

export function bindThemeToggles(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]").forEach((button) => {
    const sync = () => {
      const dark = currentTheme() === "dark";
      button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
      button.dataset.mode = dark ? "dark" : "light";
    };
    sync();
    button.addEventListener("click", () => {
      applyTheme(currentTheme() === "dark" ? "light" : "dark");
      sync();
    });
  });
}
