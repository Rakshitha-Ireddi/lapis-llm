/** Inline SVG icons (stroke-based, 24px grid). */

const paths: Record<string, string> = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  models: '<path d="M12 2 3 7l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  nodes: '<rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 6.5h.01M6 17.5h.01"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>',
  audit: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="m6 4 14 8-14 8V4Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  move: '<path d="M5 9 2 12l3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  memory: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10v4M10 10v4M14 10v4M18 10v4"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/>',
  backup: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  gauge: '<path d="M12 14 16 10"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v4a6 6 0 0 1-12 0V8Z"/>',
  windows: '<path d="M3 5.5 10 4.5v7H3ZM12 4.2 21 3v8.5h-9ZM3 12.5h7v7l-7-1ZM12 12.5h9V21l-9-1.2Z"/>',
  apple: '<path d="M16.4 12.6c0-2.4 2-3.5 2-3.6a4.3 4.3 0 0 0-3.4-1.8c-1.4-.1-2.8.9-3.5.9s-1.9-.9-3.1-.8a4.6 4.6 0 0 0-3.9 2.4c-1.7 2.9-.4 7.2 1.2 9.5.8 1.1 1.7 2.4 3 2.4s1.6-.8 3.1-.8 1.8.8 3.1.8 2.1-1.2 2.9-2.3a10 10 0 0 0 1.3-2.7 4.2 4.2 0 0 1-2.7-4ZM14 5.6A4.1 4.1 0 0 0 15 2.5a4.3 4.3 0 0 0-2.8 1.5 4 4 0 0 0-1 3 3.5 3.5 0 0 0 2.8-1.4Z"/>',
  linux: '<path d="M12 2c-2.2 0-3.5 2-3.5 4.5 0 1.6.4 2.7-.7 4.4C6.6 12.7 5 14.6 5 17c0 1 .4 1.8 1 2.4M12 2c2.2 0 3.5 2 3.5 4.5 0 1.6-.4 2.7.7 4.4 1.2 1.8 2.8 3.7 2.8 6.1 0 1-.4 1.8-1 2.4M8 20.5c1.2.9 2.5 1.5 4 1.5s2.8-.6 4-1.5"/><circle cx="10.5" cy="7" r=".6"/><circle cx="13.5" cy="7" r=".6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
};

export function icon(name: keyof typeof paths | string, extraClass = ""): string {
  const body = paths[name] ?? paths.overview;
  return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

export const platformIcon = (platform: string): string =>
  icon(platform === "windows" ? "windows" : platform === "macos" ? "apple" : "linux");

/** The LapisLLM mark: a faceted gem in smoked glass (monochrome). */
export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <defs>
    <linearGradient id="lg-a" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fafafa"/><stop offset="1" stop-color="#9c9ca3"/>
    </linearGradient>
    <linearGradient id="lg-b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a4a50"/><stop offset="1" stop-color="#111113"/>
    </linearGradient>
  </defs>
  <path d="M16 2 28 9v14l-12 7L4 23V9Z" fill="url(#lg-b)"/>
  <path d="M16 2 28 9l-12 7L4 9Z" fill="url(#lg-a)"/>
  <path d="M16 16v14L4 23V9Z" fill="#2a2a2f" opacity=".9"/>
  <path d="M16 2 28 9v14l-12 7L4 23V9Z" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8"/>
  <circle cx="11" cy="8.5" r="1.1" fill="#fff" opacity=".95"/>
</svg>`;
