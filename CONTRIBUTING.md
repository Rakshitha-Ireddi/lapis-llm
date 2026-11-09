# Contributing to LapisLLM

Thanks for helping. This page covers setup, the checks CI runs, and the conventions
that keep the two halves of the project in sync.

## Setup

```bash
# server (Python 3.11+)
cd server
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# web (Node 20+)
cd ../web
npm ci
npx playwright install chromium     # or use PW_CHANNEL=msedge / chrome
```

## Run it

```bash
lapis demo --web-dir ../web/dist    # master + 5 simulated nodes → http://localhost:8080/console.html
npm run dev                         # Vite on :5173, proxies /api and /v1 to :8080
```

## Checks (the same as CI)

```bash
# server
ruff check . && ruff format --check . && pytest --cov

# web
npm run typecheck && npm test && npm run build && npx playwright test
```

## Conventions

- **Sizing and admission live in two languages.** If you change
  `server/src/lapis/sizing.py` or `admission.py`, make the same change in
  `web/src/lib/sizing.ts` / `admission.ts`, then run
  `python scripts/gen_sizing_cases.py`. Both test-suites read
  `shared/sizing-cases.json` ([ADR 0009](docs/adr/0009-shared-sizing-fixture.md)).
- **Architecture changes need an ADR.** Copy `docs/adr/template.md`.
- **UI changes need fresh screenshots:** `npm run build && npm run screenshots`.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(server): …`, `fix(web): …`, `docs(adr): …`, `ci: …`.
- Escape every dynamic string rendered into HTML with `esc()`.
- Keep the runtime dependency list short; justify additions in the PR.

## Pull requests

Small, focused PRs with a clear "what and why" get merged fastest. The PR template has
the checklist.
