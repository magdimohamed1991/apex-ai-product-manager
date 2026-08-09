# APEX Roadmap

This roadmap reflects the **actual** state of the codebase after the
Milestone I production-hardening pass. Where the implementation is
incomplete or mocked, the status column states this explicitly.

## Phase 1 — MVP

### Product Setup

- [x] Workspace creation (with tenant isolation)
- [x] Project creation (scoped to a workspace)
- [x] Save product profile (workspace, project, repository connection)

### Integrations

- [x] **GitHub** — Real Octokit-based adapter with workspace-scoped
      APEX marker for race-safe query-before-create.
- [ ] **Jira** — Test-only mock. No production adapter is implemented.
- [ ] **Linear** — Test-only mock. No production adapter is implemented.
- [ ] **Slack** — Test-only mock. No production adapter is implemented.
- [ ] **Amplitude** — Not implemented.

### Discovery

- [x] Static analysis rules (`no-tests`, `no-ci`, `no-typescript`,
      `no-docker`)
- [x] Cross-source correlation
- [x] Repository connection & analysis pipeline
- [ ] Customer reviews ingestion — Not implemented.
- [ ] GitHub issues ingestion — Not implemented.
- [ ] Jira tickets ingestion — Not implemented.
- [ ] Linear issues ingestion — Not implemented.
- [ ] Slack product channels — Not implemented.

### Analytics

- [ ] Amplitude ingestion — Not implemented.
- [ ] Funnel drop-off detection — Not implemented.
- [ ] KPI anomaly detection — Not implemented.

### AI Reports

- [x] **H3 deterministic priority scoring** — implemented, immutable.
- [x] **H4 AI Product Reasoning** — implemented with strict schema
      validation and grounding checks. NO fabricated fallback text.
- [x] **H6 adaptive calibration** — implemented. Empirically grounded;
      insufficient evidence dampens the multiplier to 1.0.
- [x] **H5 outcome verification** — implemented. Outcomes are linked
      to actions and executions; verification uses real evidence.
- [x] **H7 product validation** — implemented. Every metric is tagged
      with an explicit epistemic state.
- [ ] Executive summary (free-form AI narrative) — Not implemented.
- [ ] Product Health Report (visual dashboard) — Not implemented.
- [ ] Recommended Actions (UI list) — Implemented (Recommendations Center).

## Phase 2 — Intentionally deferred

- Competitor Intelligence
- UX Analysis
- Browser Agent
- PRD Generator
- Sprint Planning
- Roadmap Generator

## Phase 3 — Intentionally deferred

- AI Decision Engine
- Continuous Discovery
- Growth Engine
- Revenue Intelligence
- Experimentation Engine
- Product Memory

## Phase 4 — Intentionally deferred

- Multi-company support
- Team collaboration
- AI Product Portfolio
- Marketplace
- Plugin SDK
- Enterprise features

## Production-Hardening Pass (Milestone I) — Complete

This pass focused on making the existing implementation truthful,
secure, and testable rather than adding new features.

- [x] Real password hashing (scrypt)
- [x] Cryptographically secure session IDs
- [x] Per-tenant authorization audit
- [x] Strict LLM output schema validation
- [x] Grounding check rejects unsupported `known` claims
- [x] H6 minimum-observation thresholds enforced
- [x] H6 safety floors explicit, versioned, tested
- [x] Real `executionSuccessRate` from observed action outcomes
- [x] ProductValidationService metrics typed with epistemic states
- [x] Database claims narrowed to honest guarantees
- [x] GitHubAdapter refuses silent mock downgrade in production
- [x] Mock adapters for Jira/Linear/Slack explicitly labeled
- [x] Dashboard truthfulness — no synthetic leverage display
- [x] Structured, secret-redacting logger
- [x] Typed error model with safe HTTP envelope
- [x] Request body size limit, malformed JSON handling
- [x] Security headers (X-Frame-Options, X-Content-Type-Options, etc.)
- [x] Auth rate limiting (5 attempts / 15 minutes per IP)
- [x] Background worker deduped
- [x] Resource cleanup on analysis failure
- [x] Documentation reconciled with implementation
- [x] License status documented (intentionally unlicensed)
