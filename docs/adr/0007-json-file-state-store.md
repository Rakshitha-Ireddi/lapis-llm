# 0007. A single JSON file as the state store

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

The master's durable state is small: tens of nodes, tens of models, a handful of API
keys. It changes on human timescales (approve, start, stop), not per request. Operators
should be able to read, back up and diff it without tools.

## Decision

- Durable state lives in `$LAPIS_DATA_DIR/state.json`, written **atomically**
  (temp file in the same directory + `os.replace`).
- It is rewritten only when state changes, not on every heartbeat.
- Volatile data (telemetry, rolling token rates) lives in memory.
- The audit trail is append-only JSON Lines in `audit.jsonl`.
- `JsonStore(None)` keeps everything in memory (tests, demo).
- `GET /api/backup` exports the same shape minus secrets; `POST /api/restore` previews
  the diff (`add` / `keep` / `remove`) before applying.

## Consequences

- Zero operational dependencies; `cat state.json` is the debugger.
- One master process owns the file. High availability (two masters) would need a real
  database and a new ADR.
- Running models recover after a master restart: state says they should run, the next
  heartbeat shows they don't, the reconciler restarts them one at a time per node.
