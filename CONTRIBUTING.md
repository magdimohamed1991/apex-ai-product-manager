# Contributing to APEX

APEX is currently UNLICENSED (see `LICENSE`). Contributions are
accepted under the same terms as the project: all rights remain with
the project until an explicit license is chosen.

## Development workflow

```bash
pnpm install
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

All four must pass before opening a pull request.

## Coding conventions

- TypeScript strict mode is mandatory. No `any` outside the established
  repository / API boundary adapters (and even there, prefer `unknown`).
- Follow the existing package dependency rules. `@apex/ai-core` may
  depend on `@apex/prompts`, but `@apex/prompts` MUST NOT depend on
  `@apex/ai-core`.
- The frozen execution contract is **immutable**. Changes to `Action`,
  `Execution`, `ActionTransition`, `ActionRepository`,
  `ActionApplicationService`, `ActionExecutor`, and
  `ActionExecutionWorker` require a documented architectural decision.
- New product metrics MUST declare an epistemic state
  (`unavailable` / `estimated` / `observed` / `derived` / `validated`)
  and provide a calculation string. Synthetic values presented as
  empirical observations are explicitly disallowed.

## Commit messages

Conventional commits are enforced by commitlint. Examples:

```
feat: add scrypt-based password hashing
fix: tighten GitHub adapter token detection
docs: reconcile roadmap with actual implementation
```

## Pull request expectations

- Tests for the new behavior (or a note explaining why existing
  tests are sufficient).
- Documentation updates if the change affects a user-visible contract
  (API, dashboard, error envelope, metric semantics).
- Honest status — if a feature is mock-only, label it. If a metric
  is estimated, label it. The dashboard and documentation will
  reflect this faithfully.
