# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-09

### Added

- **Master**: OpenAI-compatible `/v1` router (chat, completions, embeddings, streaming)
  with `X-Lapis-Node` response header.
- **Master**: admin API for nodes, models, API keys, audit log, backup and restore
  preview; interactive OpenAPI docs at `/docs`.
- **Master**: memory admission with plain-language refusals, best-fit placement,
  placement preview, drain / move / revoke, reconciler that restarts desired-running
  models one at a time per node.
- **Agent**: fingerprint enrolment, identity-proven claim, heartbeat telemetry, local
  admission re-check, `nvidia-smi` and Apple Silicon detection, hardware presets.
- **Runtimes**: llama.cpp, vLLM and MLX launchers; a deterministic simulated runtime.
- **CLI**: `lapis master`, `lapis agent`, `lapis demo`, `lapis estimate`.
- **Web**: landing page with live demo fleet and "Will it run?" calculator; console with
  Overview, Models, Nodes, Playground, Access and Audit pages, in demo or live mode.
- Monochrome liquid-glass design system (black, white, greys) with light and dark themes:
  light-catching rims, sliding sheen and a 3D press on every control (ADR 0013).
- Shared sizing fixture tested by both pytest and Vitest.
- CI (lint, tests, e2e, Docker build), GitHub Pages deploy, tagged releases to GHCR,
  CodeQL, Dependabot.
- Twelve architecture decision records.

### Verified on real hardware

- llama.cpp on an 8× RTX 3090 server (90 tok/s, Qwen2.5-7B Q4_K_M) and on a CPU-only
  Windows laptop.

### Fixed (found with real runtimes)

- Runtimes are pinned to the GPU admission chose (`CUDA_VISIBLE_DEVICES`, PCI order), so
  llama.cpp no longer spreads over every visible GPU on shared machines.
- Agents read live `nvidia-smi` memory each heartbeat; `--gpus` limits which cards they use.
- Upstream HTTP errors keep their status code instead of being relayed as 200.
- Embedding models get `--embeddings`; models accept extra runtime `args`.
- Heartbeats retry once on a stale keep-alive connection.
- Disk free space is measured; multi-GPU utilisation is averaged in the console.

[Unreleased]: https://github.com/Rakshitha-Ireddi/lapis-llm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Rakshitha-Ireddi/lapis-llm/releases/tag/v0.1.0
