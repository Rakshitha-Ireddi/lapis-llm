# 0009. One sizing formula, two languages, one shared fixture

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

The memory estimate appears in three places: the master's admission check (Python), the
"Will it run?" calculator on the website (TypeScript), and the console's add-model
preview. If they disagree, users lose trust in all of them.

## Decision

The formula is:

```
weights  = params × 10⁹ × bits_per_weight / 8 / 2³⁰          (q4 = 4.5 bits … fp16 = 16)
kv_cache = context × 0.125 MiB × (params / 8)^0.4 / 1024
overhead = 0.6 GiB
total    = round_half_up(weights + kv_cache + overhead, 2)
```

It is implemented twice (`server/src/lapis/sizing.py`, `web/src/lib/sizing.ts`), and
both test-suites assert against **`shared/sizing-cases.json`**, generated from the Python
side by `scripts/gen_sizing_cases.py`. Rounding is half-up in both languages to avoid
Python's banker's rounding drifting from `Math.round`.

Admission and placement are mirrored the same way (`admission.py` ↔ `admission.ts`),
including the exact refusal wording.

## Consequences

- A change to one implementation without the other fails CI.
- Two implementations still have to be edited by hand; the fixture catches drift, not
  laziness. The PR template has a checkbox for it.
