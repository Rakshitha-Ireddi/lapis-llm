# 0010. Vanilla TypeScript + Vite, deployable to GitHub Pages

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

We need a marketing site (landing page, calculator, docs links) and an operator console.
The console must work in three places: served by the master at `/`, during development
via Vite, and as a public demo on GitHub Pages under `/<repo>/`.

## Decision

- **Vite + TypeScript, no UI framework.** Two HTML entry points (`index.html`,
  `console.html`), small view modules that render template strings with an `esc()`
  helper, and event delegation per view.
- `base: "./"` so every asset URL is relative: the same build works at a domain root, a
  GitHub Pages sub-path, or behind the master.
- The console talks to a `FleetApi` interface with two implementations:
  `LiveApi` (fetch + SSE against a master) and `DemoApi` (in-browser simulated fleet).
  Mode is chosen automatically: `?api=` → live, same-origin `/healthz` says
  `lapis-master` → live, otherwise demo.
- Hash routing (`#/models`) so Pages needs no rewrite rules.

## Consequences

- ~25 KB gzipped of JavaScript, no runtime dependencies, instant loads.
- No virtual DOM: views re-render their dynamic regions on each 1 s poll and are careful
  not to clobber inputs (pending approvals only re-render when the set changes).
- Adding a large interactive feature might justify a framework later; that would be a new
  ADR.
