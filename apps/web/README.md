# APEX Web Dashboard

The APEX web dashboard (`@apex/web`) is the user-facing surface for the
APEX product management platform.

## Development

```bash
pnpm install
pnpm --filter @apex/web dev
```

The dev server starts the API server (via Vite middleware) and the
React client. See the root `README.md` for the full monorepo setup.

## Build

```bash
pnpm --filter @apex/web build
```

Outputs to `dist/`.

## Production

There is currently **no packaged production entrypoint** in this
repository: the API handler (`src/api-server.ts`) is only mounted as
Vite dev-server middleware (`pnpm --filter @apex/web dev`).

- `vite preview` (`pnpm --filter @apex/web preview`) serves the built
  static assets **only** — it does NOT mount the API middleware, so
  `/api/*` requests fail under preview. Do not use preview as a
  production server.
- A production deployment must run a Node.js process that serves
  `dist/` and routes `/api/*` through `handleApiRequest` (or mount the
  same handler behind a reverse proxy). The handler, composition root
  (`initApiServer`), and shutdown hook are exported from
  `src/api-server.ts` for this purpose; packaging this entrypoint is
  tracked as a residual deployment item in
  `docs/FINAL_PRE_H8_AUDIT.md`.

## Code layout

```
src/
  App.tsx                 - Auth flow + global fetch interceptor
  api-server.ts           - HTTP request handler (H1–H7 endpoints)
  main.tsx                - React entry
  features/
    dashboard/            - Authenticated dashboard
      api/                - HTTP client
      components/         - UI panels
      hooks/              - Data hooks
      types/              - Domain types
      page.tsx            - Coordinator component
```

(The onboarding flow lives in `App.tsx`; the legacy
`features/onboarding/**` directory was removed.)

## Security

The dashboard never stores the session token in cookies or
localStorage beyond the ephemeral `apex_session_token` key. The
Bearer token is sent on every API request via the global fetch
interceptor, and a 401 response triggers immediate sign-out.
