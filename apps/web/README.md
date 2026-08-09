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

```bash
NODE_ENV=production pnpm --filter @apex/web preview
```

The preview server serves the built static assets and proxies API
requests to the Node API server (or whatever HTTP server the same
process is configured to handle).

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
    onboarding/           - Pre-dashboard onboarding flow
```

## Security

The dashboard never stores the session token in cookies or
localStorage beyond the ephemeral `apex_session_token` key. The
Bearer token is sent on every API request via the global fetch
interceptor, and a 401 response triggers immediate sign-out.
