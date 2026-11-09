# 0008. A simulated runtime for demo, tests and screenshots

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

Most people evaluating LapisLLM don't have five GPUs on hand, and CI certainly doesn't.
We still want to exercise the real master, the real agents and the real router.

## Decision

Add a `simulated` runtime kind next to `llama.cpp`, `vllm` and `mlx`:

- `SimulatedRuntime` returns OpenAI-shaped chat, completion, embedding and SSE stream
  responses. Replies are deterministic per prompt (same input, same output), mention the
  model and node, and report real `usage` numbers.
- Hardware **presets** (`gaming-pc`, `linux-box`, `macbook`, `spark`, …) stand in for
  `nvidia-smi` / `sysctl` detection.
- `lapis demo` starts a real master plus five real agents on localhost, seeds models and
  generates light traffic.
- The browser carries a TypeScript twin of the demo fleet (`web/src/lib/demo-fleet.ts`)
  using the same admission/placement rules, so the GitHub Pages console is fully
  interactive with no backend.

## Consequences

- Every code path except the child-process launcher is tested without a GPU.
- `ProcessRuntime` (the real launcher) is covered by command-line builder tests only;
  the README is explicit that real runtimes must be installed on the node.
- The site never pretends: every simulated surface is labelled "demo" or "simulated".
