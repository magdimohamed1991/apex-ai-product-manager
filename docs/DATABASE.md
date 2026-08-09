# APEX Database

APEX uses a **production-hardened single-process durable file-backed
persistence engine**. This is the supported operating mode for the
current architecture.

## What is guaranteed

The `DurableFileDatabase` provides the following properties:

- **Atomic commit** — each commit writes the snapshot to a `.tmp` file,
  `fsync`s it, and then renames. On POSIX file systems with a single
  mounted volume, the rename is atomic. A crash that interrupts the
  process between write and rename leaves the original file intact.
- **Durability** — committed transactions survive process restart.
- **Strict domain validation at the database boundary** — every
  `insert*` method validates the entity before accepting it.
- **Uniqueness constraints**:
  - `(workspace_id, idempotency_key)` on Actions
  - `(action_id, sequence)` on ActionTransitions
  - `email` on Users (case-insensitive)
  - `(user_id, workspace_id)` on Memberships
  - `id` on Sessions (duplicate session tokens are rejected)
- **Foreign-key constraints**:
  - `executions.action_id -> actions.id`
  - `transitions.action_id -> actions.id`
- **In-process transaction snapshot** — within a single process, a
  transaction's writes are isolated from concurrent reads via a deep
  clone.
- **Deterministic migration runner** — schema migrations are applied
  in order at startup. Each migration writes a record to
  `migrations/<NNN>_migration.json`.
- **Cooperative write mutex** — concurrent commits are serialized
  in-process.

## What is NOT guaranteed (must not be claimed by callers)

- **Cross-process serializability.** The file is shared between
  processes at your own risk. There is no inter-process lock.
- **Read isolation from a concurrent writer.** Two processes
  reading the same file while a third writes can observe torn
  state.
- **Pessimistic row-level locking.** There is no `SELECT FOR UPDATE`
  semantic. The application must use leases (Actions) and
  idempotency keys to avoid races.
- **Crash recovery beyond the last successful commit.** A crash
  during commit may leave a `.tmp` file alongside `db.json`; the
  next load ignores the `.tmp` and loads `db.json`.

The class header in
`packages/ai-core/src/infrastructure/database/DurableFileDatabase.ts`
restates this contract verbatim.

## For multi-process or multi-host deployments

Replace the `DurableFileDatabase` with a real database engine (e.g.
PostgreSQL via Supabase) by writing a new repository adapter that
implements the same `ActionRepository` / `ProductRepository` /
`AdaptiveLearningProfileRepository` / `RecommendationOutcomeRepository`
contracts. **No domain changes are required.** This is the intended
extension point.

The "Tech Stack" doc and the README now reflect this honestly. The
previous `TECH_STACK.md` referenced Supabase / Drizzle / Zod /
TanStack Query / Recharts; none of those are in the actual
codebase.

## When to commit

A transaction must be `commit()`ed for changes to become visible
on disk. If the process crashes inside a transaction, the in-memory
transaction snapshot is lost and the next read returns the last
committed state. Callers that need durable side effects must
`await commit()` before declaring success.

## Tests

The hardening tests in
`packages/ai-core/src/infrastructure/database/__tests__/DurableFileDatabase.hardening.test.ts`
cover the supported guarantees:

- Commit/rollback behavior
- Uniqueness constraint enforcement
- Membership uniqueness
- Session lifecycle
- Malformed-file handling
- Active-state visibility inside vs outside a transaction
