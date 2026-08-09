# APEX — Autonomous Product Excellence

> An AI-powered Autonomous Chief Product Officer that continuously discovers opportunities, analyzes products, prioritizes work, generates documentation, and helps teams build better software.

## Status

🚧 **Active development.** APEX has substantial technical infrastructure but
the product-truth audit is still in progress. See `docs/ROADMAP.md` for
what is implemented, what is mocked, and what is intentionally
unimplemented.

## What is real today

The codebase currently implements (with real behavior and tests):

- **Multi-tenant security**: every workspace-scoped query is gated by
  `(id, workspaceId)` double-key isolation. Cross-tenant requests are
  rejected.
- **Password storage**: scrypt KDF (memory-hard, no native dependencies).
  The legacy `mock-hash:` format has been removed.
- **Session security**: 256-bit cryptographically random tokens via
  `crypto.randomBytes`. Sessions expire and can be invalidated via
  logout.
- **H3 deterministic priority scoring**: every recommendation is scored
  with an explainable formula. Scores are immutable.
- **H4 reasoning**: strict JSON schema validation, no fabricated
  fallback. Invalid LLM output is marked `unavailable` with a typed
  failure reason.
- **H6 adaptive calibration**: empirical category coefficients with
  minimum-observation thresholds. Insufficient evidence dampens the
  multiplier to 1.0. Hard safety floors for `critical >= 8.5` and
  `high >= 7.0`.
- **H5 outcome verification**: RecommendationOutcome records are linked
  to the action and execution that produced them. Verification is
  performed against supplied evidence.
- **GitHub integration**: real Octokit-based execution with a
  workspace-scoped APEX marker for query-before-create. Production code
  refuses to silently downgrade to a mock.
- **H7 product validation**: every metric is tagged with an explicit
  epistemic state (`unavailable` / `estimated` / `observed` / `derived`
  / `validated` / `insufficient_evidence`). The dashboard surfaces the
  state — there are no synthetic values presented as empirical.
- **Production-hardened single-process persistence**: atomic
  file-swap commits with deterministic migration runner.

## What is mock-only today

- **Jira / Linear / Slack adapters**: explicitly labeled test-only mocks.
  Production code paths that try to invoke them in a production
  environment will throw a `SecurityError`. Real integrations are
  not yet implemented.
- **Development LLM provider**: when `OPENAI_API_KEY` is absent, the
  development server uses an explicitly-labeled deterministic mock
  (`provider: mock`, `model: mock-v1`) whose output still passes the H4
  schema-validation and grounding pipeline. In `NODE_ENV=production` the
  server refuses to start without a real OpenAI key — a mock LLM is never
  used in production.

## What is intentionally not implemented

- **PostgreSQL / Supabase**: the repository contracts are
  database-engine agnostic. The current `DurableFileDatabase` is the
  supported single-process implementation. Replacing it with a real
  database engine requires only a new repository adapter, no domain
  changes.

## H7 decision telemetry (wired)

The PM decision telemetry stream is LIVE: when a PM approves a
recommendation, the dashboard records a real decision window
(`recommendationPresentedAt` → `decisionStartedAt` → `decisionCompletedAt`)
to `POST /api/projects/:id/decision-telemetry`. The server computes the
H3 baseline and H6 calibrated score itself (the client can never
fabricate scores), validates the timestamps, and persists the record with
a deterministic id so duplicate submissions collapse. The H7
"Measured PM Decision Latency" metric switches from `unavailable` to
`observed` as soon as the first decision is recorded — it is never
estimated from rendering time.

## Repository Structure

- `apps/` — Applications (currently `web` for the dashboard)
- `packages/` — Workspace packages (see `docs/ARCHITECTURE.md`)
- `docs/` — Architecture, roadmap, and operational documentation
- `.github/workflows/` — CI configuration

## Development

```bash
pnpm install
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

## License

This repository is currently UNLICENSED (the `LICENSE` file is empty).
All rights reserved. Adding a license requires an explicit decision;
see `docs/ROADMAP.md` for the planned governance work.
