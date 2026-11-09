# 0012. CI, Pages and release pipelines

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

Two languages, a website, a container image and a Python package all ship from one
repository. Each needs to be verified on every change and published predictably.

## Decision

GitHub Actions workflows in `.github/workflows/`:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push to `main`, PRs | Python 3.11 + 3.12: ruff lint, ruff format check, pytest with coverage. Web: typecheck, Vitest, Vite build. Playwright e2e (desktop + mobile). Docker image build (no push). |
| `pages.yml` | push to `main` touching `web/` or `shared/` | Test + build the site and deploy it to GitHub Pages. |
| `release.yml` | tag `v*.*.*` | Multi-arch image to `ghcr.io/<owner>/lapis-llm`; wheel + sdist attached to a GitHub Release. |
| `codeql.yml` | push, PRs, weekly | CodeQL for Python and TypeScript. |

Dependabot keeps pip, npm, Actions and the Docker base image current.

Playwright tests block external font CDNs so a slow network can never fail a build.

## Consequences

- `main` is always deployable; the public demo tracks `main`.
- Releases are a tag push away and reproducible.
- CI takes a few minutes, dominated by the browser download for Playwright.
