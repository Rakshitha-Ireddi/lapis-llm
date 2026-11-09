# Architecture Decision Records

Each ADR captures one decision: the context that forced it, what we chose, and what it
costs us. They are numbered, never renumbered, and superseded rather than edited when a
decision changes.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-python-fastapi-control-plane.md) | Python + FastAPI for the master and agent | Accepted |
| [0003](0003-one-openai-compatible-endpoint.md) | One OpenAI-compatible endpoint, model chosen by name | Accepted |
| [0004](0004-memory-admission-before-start.md) | Memory admission before every start, checked twice | Accepted |
| [0005](0005-best-fit-placement.md) | Best-fit placement | Accepted |
| [0006](0006-fingerprint-enrolment-and-node-secrets.md) | Fingerprint enrolment and per-node shared secrets | Accepted |
| [0007](0007-json-file-state-store.md) | A single JSON file as the state store | Accepted |
| [0008](0008-simulated-runtime.md) | A simulated runtime for demo, tests and screenshots | Accepted |
| [0009](0009-shared-sizing-fixture.md) | One sizing formula, two languages, one shared fixture | Accepted |
| [0010](0010-static-console-on-github-pages.md) | Vanilla TypeScript + Vite, deployable to GitHub Pages | Accepted |
| [0011](0011-blue-glassmorphism-design-system.md) | Blue (#0000FF) glassmorphism design system | Superseded by 0013 |
| [0012](0012-ci-and-release-pipeline.md) | CI, Pages and release pipelines | Accepted |
| [0013](0013-monochrome-liquid-glass.md) | Monochrome liquid glass | Accepted |

New ADR? Copy [template.md](template.md), take the next number, open a PR.
