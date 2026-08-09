# APEX Documentation

This directory contains the canonical APEX documentation.

## Contents

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Package layout, domain model,
  the H1–H7 milestones, and the production-hardening contracts.
- [`DATABASE.md`](./DATABASE.md) — The single-process durable database:
  supported guarantees, atomic commit protocol, and explicit
  non-guarantees.
- [`ROADMAP.md`](./ROADMAP.md) — Implemented, mock-only, and intentionally
  deferred capabilities. This document is the single source of truth for
  product claims.
- [`TECH_STACK.md`](./TECH_STACK.md) — Languages, frameworks, and runtime
  dependencies. Reflects the _current_ codebase.
- [`VISION.md`](./VISION.md) — Long-term product vision.
- [`WORKFLOWS.md`](./WORKFLOWS.md) — Operational workflows (the empty
  file has been intentionally left empty until real workflows exist).
- [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) — UI design tokens and
  conventions.
- [`adr/`](./adr/) — Architecture decision records.

## Product-truth contract

The docs in this directory are reviewed against the actual implementation
during the Milestone I production-hardening pass. Where the implementation
is incomplete or mocked, the docs state this explicitly:

- "Implemented" — verified by automated tests and a working code path.
- "Production-ready" — the system can run in production with this code.
- "Test-only" — exists in the codebase but MUST NOT be used in production.
- "Mocked" — there is a working mock used for development/testing but
  no real integration.
- "Experimental" — interface is unstable.
- "Observed" / "Estimated" / "Derived" / "Validated" /
  "Insufficient evidence" — epistemic states used in product
  metrics to make data provenance explicit to the PM.
- "Not yet implemented" — there is no code or only a stub.
