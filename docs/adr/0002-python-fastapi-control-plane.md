# 0002. Python + FastAPI for the master and agent

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

The control plane is mostly I/O: proxying streamed HTTP between clients and agents,
polling heartbeats, launching child processes. The agent must run on Windows 11, Linux
and macOS (Apple Silicon). The people most likely to run and contribute to a home LLM
fleet already have Python installed, because vLLM, MLX and most tooling are Python.

## Decision

Write both the master and the agent in Python 3.11+ as one package (`lapis-llm`) with
one CLI (`lapis master`, `lapis agent`, `lapis demo`, `lapis estimate`):

- **FastAPI** for HTTP, with Pydantic v2 models as the wire contract.
- **httpx** (async) for master→agent calls and streaming relays.
- **uvicorn** as the server.
- No database, no message broker, no Prometheus client library (see 0007 and the
  hand-rolled exposition in `metrics.py`).

## Consequences

- `pip install lapis-llm` is the whole install story on every OS.
- One language for master, agent and tests; the in-process ASGI transports let the
  test-suite run a master and several agents without opening sockets.
- Python is slower than Go/Rust for proxying, but the bottleneck is token generation on
  the GPU, not the relay. We accept the overhead.
- Four runtime dependencies keep the supply-chain surface small.

## Alternatives considered

- **Go** — single static binary is attractive for agents, but splits the codebase from
  the Python inference ecosystem and raises the bar for contributors.
- **.NET** — excellent performance and tooling, but a heavier runtime to require on
  every spare laptop.
