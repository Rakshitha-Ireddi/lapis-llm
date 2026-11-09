# API reference

The master serves interactive OpenAPI docs at **`/docs`** (Swagger UI) and
**`/redoc`**. This page is the short version.

All errors use one envelope:

```json
{ "error": { "message": "The model 'x' does not exist", "type": "not_found_error" } }
```

| Status | `type` | When |
|--------|--------|------|
| 400 | `invalid_request_error` | Bad JSON, missing `model` |
| 403 | `permission_error` | Missing/invalid admin session, API key, fingerprint or node secret |
| 404 | `not_found_error` | Unknown model, node or key |
| 409 | `conflict_error` | Admission refused, wrong state (e.g. removing a running model) |
| 422 | `invalid_request_error` | Validation, e.g. `name: model name must be lowercase…` |
| 503 | `unavailable_error` | Model not running, node offline or unreachable |

## Authentication

| Surface | Credential | Header |
|---------|------------|--------|
| `/api/*` (admin) | Session from `POST /api/auth/login` | `Authorization: Bearer <session>` |
| `/v1/*` | API key with `inference` scope (or an admin session) | `Authorization: Bearer lap_…` |
| `/metrics` | API key with `metrics` scope (or an admin session) | `Authorization: Bearer lap_…` |
| Agent ↔ master | Node secret | `X-Lapis-Token: …` |

Set `LAPIS_REQUIRE_API_KEY=false` to open `/v1` and `/metrics` on a trusted network.

## OpenAI-compatible

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/models` | Running models; each has a `lapis` object with `node`, `runtime`, `context` |
| POST | `/v1/chat/completions` | Streaming supported. Response header `X-Lapis-Node` |
| POST | `/v1/completions` | Streaming supported |
| POST | `/v1/embeddings` | |

## Admin

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/api/auth/login` | `{password}` | `{token, require_api_key}` |
| GET | `/api/overview` | | `{kpis, nodes, models}` |
| GET | `/api/nodes` | | `NodeView[]` |
| POST | `/api/nodes/{id}/approve` | `{fingerprint}` | `NodeView` |
| POST | `/api/nodes/{id}/drain` · `/undrain` · `/revoke` | | `NodeView` |
| DELETE | `/api/nodes/{id}` | | 204 (pending or revoked only) |
| GET | `/api/models` | | `ModelView[]` |
| POST | `/api/models` | `ModelSpec` | 201 `ModelView` |
| POST | `/api/models/preview` | `ModelSpec` | `{budget_gib, nodes: [{node_name, ok, reason, headroom_gib, chosen}]}` |
| POST | `/api/models/{name}/start` | `{node_id?}` | `ModelView` |
| POST | `/api/models/{name}/stop` | | `ModelView` |
| POST | `/api/models/{name}/move` | `{node_id}` | `ModelView` |
| DELETE | `/api/models/{name}` | | 204 (stopped only) |
| GET | `/api/keys` | | `ApiKeyView[]` (no secrets) |
| POST | `/api/keys` | `{name, scopes}` | 201 `ApiKeyView & {key}`, **the only time `key` is returned** |
| DELETE | `/api/keys/{id}` | | 204 |
| GET | `/api/audit?limit=100` | | newest first |
| GET | `/api/backup` | | state without secrets |
| POST | `/api/restore?dry_run=true` | backup JSON | `{dry_run, changes: {models, nodes, keys: {add, keep, remove}}}` |

### `ModelSpec`

```json
{
  "name": "qwen2.5-coder-14b",
  "source": "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
  "runtime": "llama.cpp",
  "params_b": 14.7,
  "quant": "q4",
  "context": 16384,
  "parallel": 4,
  "memory_gib": null,
  "args": []
}
```

`runtime` ∈ `llama.cpp | vllm | mlx | simulated`; `quant` ∈ `q4 | q5 | q6 | q8 | fp16`.
`args` are extra runtime flags (e.g. `["--pooling", "mean"]`).
`memory_gib: null` means "estimate it" ([ADR 0009](adr/0009-shared-sizing-fixture.md)).

## Agent protocol (internal)

| Direction | Method | Path |
|-----------|--------|------|
| agent → master | POST | `/api/enroll`, `/api/enroll/{id}/claim`, `/api/nodes/{id}/heartbeat` |
| master → agent | GET | `/agent/health`, `/agent/telemetry` |
| master → agent | POST | `/agent/models/start` (`ModelSpec`), `/agent/models/{name}/stop` |
| master → agent | POST | `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings` |

## Metrics

```
lapis_requests_total{model,status}     counter
lapis_tokens_total{model}              counter
lapis_requests_in_flight               gauge
lapis_node_up{node}                    gauge
lapis_node_memory_free_gib{node}       gauge
lapis_model_running{model}             gauge
```
