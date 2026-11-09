# 0003. One OpenAI-compatible endpoint, model chosen by name

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

Every inference server (llama.cpp, vLLM, MLX) already speaks a dialect of the OpenAI
API, each on its own host and port. Clients (IDE agents, scripts, chat UIs) all support
"OpenAI base URL + key + model name". What they don't support is knowing that model A
lives on `192.168.1.20:8081` and model B on `192.168.1.22:8000`.

## Decision

The master exposes a single `/v1` surface:

- `GET /v1/models` lists models that are **running** anywhere in the fleet.
- `POST /v1/chat/completions`, `/v1/completions`, `/v1/embeddings` look up the `model`
  field, find the node serving it, and proxy the request body unchanged.
- Streaming (`"stream": true`) is relayed chunk by chunk; the master only peeks at the
  tail to count tokens from the final `usage` event.
- Every proxied response carries `X-Lapis-Node: <node name>` so a client can tell who
  answered.
- Errors use the OpenAI error envelope (`{"error": {"message", "type"}}`) with 404 for
  unknown models and 503 for models that exist but aren't running.

## Consequences

- Any OpenAI SDK works unchanged; moving a model between machines is invisible to
  clients.
- The master doesn't need to understand runtime-specific features; it passes bodies
  through. Runtime-specific parameters still reach the runtime.
- One model name maps to one running instance. Replicas (the same model on two nodes
  with load balancing) are not supported yet; the data model leaves room for it.
