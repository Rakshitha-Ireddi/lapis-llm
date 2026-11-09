# 0006. Fingerprint enrolment and per-node shared secrets

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

Anything that can join the fleet can receive prompts and serve answers, so joining must
require a human decision. At the same time, adding a machine should be one command, not
a certificate ceremony.

## Decision

1. On first start the agent generates a random 256-bit **identity** and keeps it in
   `.lapis-agent/agent.json`. Only `public_key = SHA-256(identity)` is sent to the master.
2. `POST /api/enroll` registers the node as **pending** and returns a **fingerprint**:
   the first 16 bytes of `SHA-256(public_key)`, printed as `AB:CD:…` on the agent's
   console and shown in the UI.
3. An admin approves by entering the fingerprint they read on the machine. A mismatch
   is refused and audited.
4. On approval the master issues a random **node secret**. The agent claims it with
   `POST /api/enroll/{id}/claim {identity}`; the master checks
   `SHA-256(identity) == public_key`, so knowing a node ID is not enough.
5. The secret authenticates both directions: agent→master heartbeats and master→agent
   calls carry `X-Lapis-Token`. Comparisons are constant-time.
6. **Revoke** deletes the secret immediately; the identity can no longer claim.
7. Backups exclude secrets. After a restore the master issues fresh ones and agents
   re-claim automatically when their next heartbeat gets 403.

Admin sessions are separate: stateless HMAC-signed tokens (`<expiry>.<hmac>`).
API keys are separate again: `lap_…`, stored as SHA-256, shown once, scoped
(`inference`, `metrics`).

## Consequences

- Joining is one command plus one comparison in the browser.
- The secret is symmetric and travels in a header, so traffic must stay on a trusted
  LAN or go through TLS. **mTLS between master and agents is the planned successor** and
  will supersede this ADR.
- No PKI to operate today.
