# Technology Stack

The actual technologies in use in the codebase as of the Milestone I
production-hardening pass. Items in **bold** are first-party packages
maintained inside this monorepo.

## Languages

- **TypeScript 6.0** (strict mode in every package)
- Node.js 22+

## Package Manager & Build

- **pnpm 9** workspaces
- **Turborepo 2** for task orchestration
- **Vite 8** for the web bundle
- **ESLint 10** + **typescript-eslint 8**
- **Prettier 3** + **Husky 9** + **lint-staged**
- **commitlint** with conventional commits

## Frontend

- React 19
- Tailwind CSS 4
- TypeScript with `react-jsx` and `verbatimModuleSyntax`

## Backend / Runtime

- **Node.js 22+** built-in `crypto.scrypt` for password hashing
- **Node.js 22+** built-in `crypto.randomBytes` for session ID generation
- **@octokit/rest 22** for the real GitHub adapter
- **No third-party database** — production currently uses the
  production-hardened single-process `DurableFileDatabase` (see
  `docs/DATABASE.md`).

## LLM Providers

- **`MockLLMProvider`** — deterministic, used in tests and the dev
  server. **Test-only.**
- **`OpenAIResponsesProvider`** — production LLM client targeting the
  Responses API. Honors the H4 contract: system instructions,
  structured output, retries, timeouts, error normalization.
- **`BudgetPolicy`** — cost / token budgets per environment.

## AI / Agent Layer

- **`@apex/prompts`** — Prompt builders (depends only on
  `@apex/analysis` and `@apex/contracts`, never on `@apex/ai-core`).
- **`@apex/ai-core`** — Agents, intelligence pipeline, application
  services, repositories, security primitives, observability, and the
  typed error model.

## Not in Use

The following were referenced in the legacy `docs/TECH_STACK.md` but are
NOT actually in the codebase as of this pass:

- **Supabase** — the production database is the durable file-backed
  engine. No Supabase code is in the repository.
- **Supabase Auth** — replaced by the in-house `AuthService` (scrypt +
  secure session tokens).
- **Supabase Storage** — not used.
- **Drizzle ORM** — not used.
- **Zod** — the codebase performs strict runtime validation by hand
  rather than through Zod. (Zod could be introduced later; the
  domain types are deliberately framework-agnostic.)
- **TanStack Query / Zustand** — the current frontend uses local
  React state with a thin fetch wrapper. (The hook structure in
  `useDashboardData.ts` could be migrated to TanStack Query later.)
- **Recharts / TanStack Table** — not in the dependency tree.
- **Vercel** — there is no deployment configuration. The repository
  is intended to run as a Node.js process behind any reverse proxy.
- **Drizzle ORM, Supabase Auth, Amplitude** — same.

If a future milestone introduces any of these, the change must be
reflected here AND in `package.json` so the documentation never
diverges from the dependency tree.
