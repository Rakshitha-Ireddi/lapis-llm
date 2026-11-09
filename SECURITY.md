# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's
[private vulnerability reporting](../../security/advisories/new) for this repository.
Include a description, the affected version, and steps to reproduce. You should get an
acknowledgement within a few days.

## Supported versions

Only the latest release receives security fixes while the project is pre-1.0.

## Deployment guidance

LapisLLM is designed for networks you control.

- Run the master on a trusted LAN, or put it behind a TLS-terminating reverse proxy
  (Caddy, nginx, Traefik) before exposing it further.
- Set a strong `LAPIS_ADMIN_PASSWORD` and pin `LAPIS_SESSION_SECRET`.
- Keep `LAPIS_REQUIRE_API_KEY=true`; issue one key per person or app and revoke freely.
- Approve nodes only after comparing the fingerprint printed **on the machine itself**.
- Master ↔ agent traffic is authenticated with a per-node shared secret but is not
  encrypted unless you add TLS. mTLS is on the roadmap
  ([ADR 0006](docs/adr/0006-fingerprint-enrolment-and-node-secrets.md)).
- Leave `LAPIS_AUTO_APPROVE` off outside the local demo.
