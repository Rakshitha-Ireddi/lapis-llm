## What and why

<!-- One or two sentences. Link the issue: Closes #123 -->

## How it was tested

- [ ] `pytest` (server)
- [ ] `npm test` and `npm run typecheck` (web)
- [ ] `npx playwright test` (if UI changed)
- [ ] Screenshots regenerated with `npm run screenshots` (if UI changed)

## Checklist

- [ ] Sizing changes are mirrored in `server/src/lapis/sizing.py` **and** `web/src/lib/sizing.ts`, and `shared/sizing-cases.json` is regenerated
- [ ] Architecture changes come with a new ADR in `docs/adr/`
- [ ] `CHANGELOG.md` updated
