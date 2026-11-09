# Architecture

LapisLLM has two processes and one browser app.

```mermaid
flowchart LR
  subgraph Clients
    A[IDE agents]:::c
    B[Scripts / SDKs]:::c
    C[Chat UIs]:::c
  end

  subgraph Master["lapis master"]
    R["/v1 router"]
    REG[Registry + state.json]
    ADM[Admission + placement]
    API["/api admin + console"]
    MET["/metrics"]
  end

  subgraph Agents
    G["gaming-pc<br/>llama.cpp"]
    L["linux-box<br/>vLLM"]
    M["macbook<br/>MLX"]
  end

  A & B & C -- "OpenAI API + lap_ key" --> R
  R -- "X-Lapis-Token" --> G & L & M
  G & L & M -- "heartbeat + telemetry" --> REG
  API --> ADM --> REG
  classDef c fill:#18181b,color:#fff,stroke:#fff
```

## Components

| Module | Responsibility |
|--------|----------------|
| `lapis.sizing` | Memory estimate from params / quant / context ([ADR 0009](adr/0009-shared-sizing-fixture.md)) |
| `lapis.admission` | Will this budget fit on this node, and if not, why ([ADR 0004](adr/0004-memory-admission-before-start.md)) |
| `lapis.placement` | Evaluate every node, pick best fit ([ADR 0005](adr/0005-best-fit-placement.md)) |
| `lapis.master.fleet` | Source of truth: nodes, models, keys, reconcile, backup/restore |
| `lapis.master.agent_client` | Master → agent HTTP (start, stop, proxy, stream) |
| `lapis.master.app` | FastAPI app: `/api`, `/v1`, `/metrics`, `/healthz`, static console |
| `lapis.agent.node` | The agent's view of its machine: telemetry, local admission, enrol/claim/heartbeat loop |
| `lapis.agent.runtimes` | `SimulatedRuntime` and `ProcessRuntime` (llama.cpp / vLLM / MLX) |
| `lapis.agent.hardware` | `nvidia-smi` / `sysctl` detection and simulated presets |
| `lapis.security` | Fingerprints, HMAC sessions, API key and secret generation |
| `lapis.store`, `lapis.audit`, `lapis.metrics` | JSON state, JSONL audit, Prometheus text |

## Request flow: a streamed chat completion

```mermaid
sequenceDiagram
  participant C as Client
  participant M as Master
  participant A as Agent (studio-pc)
  participant R as llama-server
  C->>M: POST /v1/chat/completions {model:"qwen2.5-coder-14b", stream:true}
  M->>M: check API key scope "inference"
  M->>M: route(model) → running on studio-pc
  M->>A: POST /v1/chat/completions (X-Lapis-Token)
  A->>R: POST 127.0.0.1:<port>/v1/chat/completions
  R-->>A: SSE chunks
  A-->>M: SSE chunks
  M-->>C: SSE chunks + X-Lapis-Node: studio-pc
  M->>M: read usage from final event → metrics, leaderboard
```

## Lifecycle: joining a machine

```mermaid
sequenceDiagram
  participant Ag as Agent
  participant M as Master
  participant U as Admin (console)
  Ag->>Ag: identity = random 256 bit, public = SHA-256(identity)
  Ag->>M: POST /api/enroll {name, url, platform, runtimes, public}
  M-->>Ag: {node_id, fingerprint, state: pending}
  Ag->>Ag: print fingerprint
  loop until approved
    Ag->>M: POST /api/enroll/{id}/claim {identity} → 202 pending
  end
  U->>M: POST /api/nodes/{id}/approve {fingerprint}
  Ag->>M: claim → 200 {secret}
  loop every 5 s
    Ag->>M: POST /api/nodes/{id}/heartbeat (telemetry)
    M->>M: sync model states, reconcile
  end
```

## Model states

```mermaid
stateDiagram-v2
  [*] --> stopped
  stopped --> starting: start (admission ok)
  stopped --> failed: admission refused
  starting --> running: agent started runtime
  starting --> failed: agent refused / runtime error
  running --> stopped: stop
  running --> stopped: heartbeat shows it gone
  failed --> starting: start again
  stopped --> starting: reconciler (desired = running)
```

`desired` is separate from `state`. After a node or master restart, the reconciler
restarts only models whose `desired` is `running`, one at a time per node. A model the
operator stopped stays stopped.

## What the master never does

- Touch a GPU or a model file. Agents own their machine.
- Store plaintext API keys. Only SHA-256 hashes are persisted.
- Return node secrets or public keys through the admin API.

## Tests

| Layer | Tool | Where |
|-------|------|-------|
| Python units + integration | pytest, in-process ASGI transports (master + N agents, no sockets) | `server/tests` |
| TypeScript units | Vitest | `web/tests` |
| Cross-language contract | shared fixture | `shared/sizing-cases.json` |
| Browser e2e | Playwright (desktop + Pixel 7) | `web/e2e` |
| Screenshots | Playwright | `web/e2e/screenshots.spec.ts` → `docs/screenshots` |
