# 0004. Memory admission before every start, checked twice

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

The most common failure on a home GPU is starting a model that doesn't fit: the runtime
loads for a minute, then dies with an out-of-memory error, sometimes taking the desktop
session with it. On discrete GPUs, "16 GB total" across two 8 GB cards does not mean a
10 GB model fits.

## Decision

Every model has a **memory budget**: either set explicitly or estimated from parameter
count, quantisation and context length (see 0009). Before a start:

1. **The master** checks the budget against the node's last telemetry, minus a
   configurable **reserve** (`LAPIS_MEMORY_RESERVE_GIB`, default 1 GiB) for the OS and
   desktop.
2. **The agent** re-checks against its own live view before launching, because the
   master's telemetry can be a heartbeat old. The agent has the final word.

Rules (`admission.check`):

- Unified memory (Apple Silicon, GB10) — budget ≤ pool free − reserve.
- Discrete GPUs — budget ≤ the roomiest *single* GPU's free − reserve. No splitting.
- The node must offer the model's runtime.

A refusal is never just "no": it states needed vs. free vs. reserve, e.g.
*"needs 10.44 GiB but the roomiest GPU (GeForce RTX 3070) has 0.61 GiB free after the
1.00 GiB reserve"*. The same wording appears in the API, the console and the audit log.

## Consequences

- OOM-at-load becomes a fast, explained refusal.
- Estimates are rules of thumb; operators can override with an explicit `memory_gib`.
- Tensor-parallel placement across GPUs is deliberately out of scope until we have a
  separate ADR for it.
