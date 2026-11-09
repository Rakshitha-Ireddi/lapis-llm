# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

LapisLLM makes several choices that are not obvious from the code alone: why memory is
checked twice, why placement prefers the *smallest* machine that fits, why the website
and the master share a test fixture. Without a record, contributors either re-litigate
them or change them by accident.

## Decision

We keep lightweight Architecture Decision Records (Michael Nygard's format) in
`docs/adr/`, one Markdown file per decision, numbered sequentially. An ADR is never
rewritten after it is accepted; a new ADR supersedes it.

Pull requests that change an architectural decision must add or supersede an ADR (the
PR template asks).

## Consequences

- The "why" lives next to the code and is versioned with it.
- Writing an ADR costs a few minutes per decision; we accept that.
- Superseded ADRs stay in the repository as history.
