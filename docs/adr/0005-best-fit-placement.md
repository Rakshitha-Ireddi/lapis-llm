# 0005. Best-fit placement

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

When a model is started without naming a node, the master has to pick one. A home fleet
is wildly heterogeneous: an 8 GB gaming PC next to a 128 GB unified-memory box. A naive
"most free memory" policy puts an 8B model on the 128 GB machine, and then the 70B model
has nowhere to go.

## Decision

Placement is **best fit**: among online nodes that pass admission (0004), choose the one
with the *least* headroom left after the model starts. Ties break by node name for
determinism.

Additional rules:

- A model that was already placed on a node prefers that node again if it still fits
  (warm caches, predictable routing).
- `draining` nodes keep serving but receive no new placements.
- The operator can always pin a node explicitly (`node_id` on start, or *Move*).
- `POST /api/models/preview` returns the admission result for every node and marks the
  chosen one, so the console can show the decision before it is made.

## Consequences

- Big machines stay free for big models; small models pack onto small machines.
- Best fit can leave a machine nearly full; the reserve (0004) protects the desktop.
- No load-aware balancing: placement looks at memory, not current traffic. That is a
  future ADR if replicas arrive.
