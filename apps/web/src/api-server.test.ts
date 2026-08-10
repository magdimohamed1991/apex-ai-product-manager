/**
 * API server integration tests (route inventory + security boundaries).
 *
 * These tests drive the REAL `handleApiRequest` through minimal Node
 * request/response objects. They cover:
 *   - production composition root refuses a mock LLM provider
 *   - signup → session → workspace listing flow
 *   - cross-tenant isolation on project-scoped resources
 *   - idempotent approval + transition audit
 *   - typed "reasoning unavailable" instead of fabricated H3 decoration
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const TEST_DB_DIR = path.join(process.cwd(), 'database-api-server-test')

interface ReqOptions {
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
}

function makeRes() {
  // Methods close over the same object they mutate (no spread copies — a
  // spread would shadow `body`/`statusCode` writes with stale values).
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(status: number, headers: Record<string, string>): void {
      res.statusCode = status
      res.headers = headers
    },
    setHeader(k: string, v: string): void {
      res.headers[k] = v
    },
    end(payload: string): void {
      res.body = payload
    },
  }
  return res
}

async function request(
  api: typeof import('./api-server'),
  opts: ReqOptions
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { Readable } = await import('node:stream')
  const payload = opts.body === undefined ? null : JSON.stringify(opts.body)

  // A real Readable stream so `getBody`'s data/end listeners behave like
  // production HTTP request bodies. Header keys are lowercased exactly like
  // Node's real HTTP parser does.
  const req = Readable.from(payload === null ? [] : [Buffer.from(payload)]) as unknown as Record<
    string,
    unknown
  >
  req.method = opts.method
  req.url = opts.url
  const headers: Record<string, string> = { 'x-forwarded-for': '127.0.0.1' }
  for (const [k, v] of Object.entries(opts.headers || {})) {
    headers[k.toLowerCase()] = v
  }
  req.headers = headers
  req.socket = { remoteAddress: '127.0.0.1' }

  const res = makeRes()
  await api.handleApiRequest(req as never, res as never)
  const json = res.body ? (JSON.parse(res.body) as Record<string, unknown>) : {}
  console.log('DBG', opts.method, opts.url, '=>', res.statusCode, res.body.slice(0, 120))
  return { status: res.statusCode, json }
}

describe('API server — composition root & route security', () => {
  let api: typeof import('./api-server')

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
    }
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_PATH = TEST_DB_DIR
    delete process.env.OPENAI_API_KEY
    vi.resetModules()
    api = await import('./api-server')
  })

  afterEach(async () => {
    api.shutdownApiServer()
    delete process.env.DATABASE_PATH
    delete process.env.OPENAI_API_KEY
  })

  it('refuses to start with a mock LLM provider in production when OPENAI_API_KEY is missing', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.OPENAI_API_KEY
    vi.resetModules()
    const prod = await import('./api-server')
    await expect(prod.initApiServer()).rejects.toThrow(/OPENAI_API_KEY/)
    prod.shutdownApiServer()
  })

  it('signs up, lists workspaces, and serves the session', async () => {
    await api.initApiServer()

    const signup = await request(api, {
      method: 'POST',
      url: '/api/auth/signup',
      body: { email: 'pm@acme.com', password: 'super-secure-password' },
    })
    expect(signup.status).toBe(200)
    const token = signup.json.token as string
    expect(token).toBeTruthy()

    const session = await request(api, {
      method: 'GET',
      url: '/api/auth/session',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(session.status).toBe(200)
    const user = session.json.user as { email: string }
    expect(user.email).toBe('pm@acme.com')

    const workspaces = await request(api, {
      method: 'GET',
      url: '/api/workspaces',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(workspaces.status).toBe(200)
    expect(Array.isArray(workspaces.json)).toBe(true)
  })

  it('enforces tenant isolation: workspace B cannot read workspace A projects', async () => {
    await api.initApiServer()
    const signupA = await request(api, {
      method: 'POST',
      url: '/api/auth/signup',
      body: { email: 'a@acme.com', password: 'super-secure-password' },
    })
    const signupB = await request(api, {
      method: 'POST',
      url: '/api/auth/signup',
      body: { email: 'b@acme.com', password: 'super-secure-password' },
    })
    const tokenA = signupA.json.token as string
    const tokenB = signupB.json.token as string
    const wsA = (signupA.json.workspace as { id: string }).id
    const wsB = (signupB.json.workspace as { id: string }).id
    expect(wsA).not.toBe(wsB)

    // A lists projects in its own workspace.
    const projectsA = await request(api, {
      method: 'GET',
      url: `/api/projects?workspaceId=${wsA}`,
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    expect(projectsA.status).toBe(200)

    // B asks for A's workspace projects → denied (not a member).
    const cross = await request(api, {
      method: 'GET',
      url: `/api/projects?workspaceId=${wsA}`,
      headers: { Authorization: `Bearer ${tokenB}` },
    })
    expect(cross.status).toBe(403)

    // A cannot list B's projects either.
    const cross2 = await request(api, {
      method: 'GET',
      url: `/api/projects?workspaceId=${wsB}`,
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    expect(cross2.status).toBe(403)
  })

  it('denies ID-substitution access on every project-scoped resource (findings, recommendations, outcomes, metrics, profile, reasoning)', async () => {
    await api.initApiServer()
    const signupA = await request(api, {
      method: 'POST',
      url: '/api/auth/signup',
      body: { email: 'owner@acme.com', password: 'super-secure-password' },
    })
    const signupB = await request(api, {
      method: 'POST',
      url: '/api/auth/signup',
      body: { email: 'intruder@acme.com', password: 'super-secure-password' },
    })
    const tokenB = signupB.json.token as string
    const wsA = (signupA.json.workspace as { id: string }).id

    // Attacker B holds a valid session for THEIR workspace but requests
    // workspace A's resources by id. Every endpoint must return 403.
    const attempts = [
      ['GET', `/api/projects?workspaceId=${wsA}`],
      ['GET', `/api/projects/proj-core/repository?workspaceId=${wsA}`],
      ['GET', `/api/projects/proj-core/findings?workspaceId=${wsA}`],
      ['GET', `/api/projects/proj-core/recommendations?workspaceId=${wsA}`],
      ['GET', `/api/projects/proj-core/activity?workspaceId=${wsA}`],
      ['GET', `/api/projects/proj-core/decision-metrics?workspaceId=${wsA}`],
      ['GET', `/api/projects/proj-core/outcomes?workspaceId=${wsA}`],
      ['GET', `/api/projects/proj-core/profile?workspaceId=${wsA}`],
      ['GET', `/api/projects/proj-core/learning-signals?workspaceId=${wsA}`],
      ['GET', `/api/projects/proj-core/product-value?workspaceId=${wsA}`],
      ['GET', `/api/recommendations/rec-any/reasoning?workspaceId=${wsA}`],
      ['GET', `/api/recommendations/rec-any/calibration?workspaceId=${wsA}&projectId=proj-core`],
      ['POST', `/api/projects/proj-core/analysis`],
      ['POST', `/api/projects/proj-core/decision-telemetry`],
    ] as const

    for (const [method, url] of attempts) {
      const res = await request(api, {
        method,
        url,
        headers: { Authorization: `Bearer ${tokenB}` },
        body: method === 'POST' ? { workspaceId: wsA } : undefined,
      })
      expect(res.status, `${method} ${url}`).toBe(403)
    }
  })

  it('approves idempotently through the canonical /api/actions/approve route', async () => {
    await api.initApiServer()
    const signup = await request(api, {
      method: 'POST',
      url: '/api/auth/signup',
      body: { email: 'flow@acme.com', password: 'super-secure-password' },
    })
    const token = signup.json.token as string
    const wsId = (signup.json.workspace as { id: string }).id

    // Connect repository + run analysis.
    const conn = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/repository',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        workspaceId: wsId,
        provider: 'github',
        owner: 'acme',
        repository: 'apex-ai-product-manager',
        defaultBranch: 'main',
      },
    })
    expect(conn.status).toBe(200)

    const run = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/analysis',
      headers: { Authorization: `Bearer ${token}` },
      body: { workspaceId: wsId },
    })
    expect(run.status).toBe(200)
    expect((run.json as { status: string }).status).toBe('completed')

    const recs = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/recommendations?workspaceId=${wsId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    const list = recs.json as unknown as Array<{
      id: string
      proposedActions: Array<{ id: string }>
      pmCategory?: string
      priorityScore?: number
    }>
    expect(list.length).toBeGreaterThan(0)
    const rec = list[0]

    const approve = async () =>
      request(api, {
        method: 'POST',
        url: '/api/actions/approve',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          workspaceId: wsId,
          projectId: 'proj-core',
          recommendationId: rec.id,
          proposedActionId: rec.proposedActions[0].id,
        },
      })

    const first = await approve()
    expect(first.status).toBe(200)
    const actionId = (first.json as { id: string }).id

    const second = await approve()
    expect((second.json as { id: string }).id).toBe(actionId)
  })

  it('returns typed reasoning-unavailable instead of fabricating H3 decoration', async () => {
    await api.initApiServer()
    // Insert a bare recommendation (no RichRecommendation decoration) via a
    // signed-up workspace's project.
    const signup = await request(api, {
      method: 'POST',
      url: '/api/auth/signup',
      body: { email: 'bare@acme.com', password: 'super-secure-password' },
    })
    const token = signup.json.token as string
    const wsId = (signup.json.workspace as { id: string }).id

    const bare = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/repository',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        workspaceId: wsId,
        provider: 'github',
        owner: 'acme',
        repository: 'apex-ai-product-manager',
        defaultBranch: 'main',
      },
    })
    expect(bare.status).toBe(200)

    // Reasoning for a recommendation that does not exist → 404.
    const missing = await request(api, {
      method: 'GET',
      url: `/api/recommendations/rec-does-not-exist/reasoning?workspaceId=${wsId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(missing.status).toBe(404)
  })

  it('records a PM decision through the telemetry route and elevates decision latency to observed', async () => {
    await api.initApiServer()
    const signup = await request(api, {
      method: 'POST',
      url: '/api/auth/signup',
      body: { email: 'telemetry@acme.com', password: 'super-secure-password' },
    })
    const token = signup.json.token as string
    const wsId = (signup.json.workspace as { id: string }).id

    const conn = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/repository',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        workspaceId: wsId,
        provider: 'github',
        owner: 'acme',
        repository: 'apex-ai-product-manager',
        defaultBranch: 'main',
      },
    })
    expect(conn.status).toBe(200)

    const run = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/analysis',
      headers: { Authorization: `Bearer ${token}` },
      body: { workspaceId: wsId },
    })
    expect(run.status).toBe(200)

    const recs = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/recommendations?workspaceId=${wsId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    const list = recs.json as unknown as Array<{ id: string }>
    expect(list.length).toBeGreaterThan(0)

    const record = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/decision-telemetry',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        workspaceId: wsId,
        recommendationId: list[0].id,
        decision: 'ACCEPT',
        decisionStartedAt: '2026-08-09T10:00:00.000Z',
        decisionCompletedAt: '2026-08-09T10:02:00.000Z',
        recommendationPresentedAt: '2026-08-09T09:58:00.000Z',
      },
    })
    expect(record.status).toBe(200)
    const recorded = record.json as { id: string; originalH3Score: number }
    expect(recorded.id).toMatch(/^pmd-/)
    expect(recorded.originalH3Score).toBeGreaterThan(0)

    // Invalid decision kind → 400.
    const bad = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/decision-telemetry',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        workspaceId: wsId,
        recommendationId: list[0].id,
        decision: 'MAYBE',
        decisionStartedAt: '2026-08-09T10:00:00.000Z',
        decisionCompletedAt: '2026-08-09T10:02:00.000Z',
        recommendationPresentedAt: '2026-08-09T09:58:00.000Z',
      },
    })
    expect(bad.status).toBe(400)

    // Decision latency is now OBSERVED with the real measured value.
    const value = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/product-value?workspaceId=${wsId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    const metrics = value.json as {
      measuredDecisionLatencySeconds: {
        epistemicState: string
        value: number
        observationCount: number
      }
    }
    expect(metrics.measuredDecisionLatencySeconds.epistemicState).toBe('observed')
    expect(metrics.measuredDecisionLatencySeconds.value).toBe(120)
    expect(metrics.measuredDecisionLatencySeconds.observationCount).toBe(1)
  })

  it('accepts every H7 decision kind (ACCEPT/REJECT/DEFER/OVERRIDE) with correct override semantics', async () => {
    await api.initApiServer()
    const signup = await request(api, {
      method: 'POST',
      url: '/api/auth/signup',
      body: { email: 'kinds@acme.com', password: 'super-secure-password' },
    })
    const token = signup.json.token as string
    const wsId = (signup.json.workspace as { id: string }).id

    await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/repository',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        workspaceId: wsId,
        provider: 'github',
        owner: 'acme',
        repository: 'apex-ai-product-manager',
        defaultBranch: 'main',
      },
    })
    await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/analysis',
      headers: { Authorization: `Bearer ${token}` },
      body: { workspaceId: wsId },
    })
    const recs = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/recommendations?workspaceId=${wsId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    const list = recs.json as unknown as Array<{ id: string }>
    const recId = list[0].id

    // Each decision is a DISTINCT decision window (different decisionStartedAt)
    // — the deterministic telemetry id collapses only identical submissions.
    const windows = [
      {
        decisionStartedAt: '2026-08-09T10:00:00.000Z',
        decisionCompletedAt: '2026-08-09T10:01:00.000Z',
        decision: 'REJECT',
      },
      {
        decisionStartedAt: '2026-08-09T11:00:00.000Z',
        decisionCompletedAt: '2026-08-09T11:01:00.000Z',
        decision: 'DEFER',
      },
    ] as const
    for (const w of windows) {
      const res = await request(api, {
        method: 'POST',
        url: '/api/projects/proj-core/decision-telemetry',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          workspaceId: wsId,
          recommendationId: recId,
          decision: w.decision,
          decisionStartedAt: w.decisionStartedAt,
          decisionCompletedAt: w.decisionCompletedAt,
          recommendationPresentedAt: '2026-08-09T09:59:00.000Z',
        },
      })
      expect(res.status, w.decision).toBe(200)
    }
    // OVERRIDE with a numeric PM priority: overrideOccurred must be true and
    // the delta must be |H6 calibrated - PM priority|.
    const override = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/decision-telemetry',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        workspaceId: wsId,
        recommendationId: recId,
        decision: 'OVERRIDE',
        pmSelectedPriority: 1,
        decisionStartedAt: '2026-08-09T12:00:00.000Z',
        decisionCompletedAt: '2026-08-09T12:01:00.000Z',
        recommendationPresentedAt: '2026-08-09T11:59:00.000Z',
      },
    })
    expect(override.status).toBe(200)
    const ov = override.json as {
      overrideOccurred: boolean
      overrideDelta: number
      calibratedH6Score: number
    }
    expect(ov.overrideOccurred).toBe(true)
    expect(ov.overrideDelta).toBeCloseTo(Math.abs(ov.calibratedH6Score - 1), 5)
  })

  it('rejects every timestamp-integrity violation at the HTTP boundary (never repaired)', async () => {
    await api.initApiServer()
    const signup = await request(api, {
      method: 'POST',
      url: '/api/auth/signup',
      body: { email: 'ts@acme.com', password: 'super-secure-password' },
    })
    const token = signup.json.token as string
    const wsId = (signup.json.workspace as { id: string }).id

    await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/repository',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        workspaceId: wsId,
        provider: 'github',
        owner: 'acme',
        repository: 'apex-ai-product-manager',
        defaultBranch: 'main',
      },
    })
    await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/analysis',
      headers: { Authorization: `Bearer ${token}` },
      body: { workspaceId: wsId },
    })
    const recs = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/recommendations?workspaceId=${wsId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    const recId = (recs.json as unknown as Array<{ id: string }>)[0].id

    const now = Date.now()
    const iso = (ms: number) => new Date(ms).toISOString()
    const base = {
      workspaceId: wsId,
      recommendationId: recId,
      decision: 'ACCEPT',
    }
    // Valid window used as the healthy baseline.
    const valid = {
      ...base,
      recommendationPresentedAt: iso(now - 120000),
      decisionStartedAt: iso(now - 60000),
      decisionCompletedAt: iso(now - 1000),
    }

    // The valid baseline is accepted.
    const ok = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/decision-telemetry',
      headers: { Authorization: `Bearer ${token}` },
      body: valid,
    })
    expect(ok.status).toBe(200)

    const violations: Array<[string, Record<string, unknown>, RegExp]> = [
      [
        'presentedAt > startedAt (presentation after decision start)',
        {
          ...valid,
          recommendationPresentedAt: iso(now - 1000),
          decisionStartedAt: iso(now - 60000),
        },
        /must not follow decisionStartedAt/,
      ],
      [
        'startedAt > completedAt',
        {
          ...valid,
          decisionStartedAt: iso(now - 1000),
          decisionCompletedAt: iso(now - 60000),
        },
        /must not precede decisionStartedAt/,
      ],
      [
        'negative duration',
        {
          ...valid,
          decisionStartedAt: iso(now - 60000),
          decisionCompletedAt: iso(now - 120000),
        },
        /must not precede decisionStartedAt/,
      ],
      [
        'startedAt more than 5 minutes in the future (clock skew)',
        {
          ...valid,
          decisionStartedAt: iso(now + 6 * 60 * 1000),
          decisionCompletedAt: iso(now + 6 * 60 * 1000 + 60000),
        },
        /decisionStartedAt is more than 5 minutes in the future/,
      ],
      [
        'completedAt more than 5 minutes in the future (clock skew)',
        {
          ...valid,
          decisionCompletedAt: iso(now + 6 * 60 * 1000),
        },
        /decisionCompletedAt is more than 5 minutes in the future/,
      ],
      [
        'presentedAt more than 5 minutes in the future (clock skew)',
        {
          ...valid,
          // Keep window ordering valid (presented <= started <= completed)
          // so the clock-skew policy is the violated check.
          recommendationPresentedAt: iso(now + 6 * 60 * 1000),
          decisionStartedAt: iso(now + 6 * 60 * 1000 + 60000),
          decisionCompletedAt: iso(now + 6 * 60 * 1000 + 120000),
        },
        /recommendationPresentedAt is more than 5 minutes in the future/,
      ],
      [
        'duration > 24 hours',
        {
          ...valid,
          // Window ordering stays valid (presented < started < completed);
          // only the 24h duration bound is violated.
          recommendationPresentedAt: iso(now - 25 * 60 * 60 * 1000 - 60000),
          decisionStartedAt: iso(now - 25 * 60 * 60 * 1000),
        },
        /exceeds maximum allowed \(24 hours\)/,
      ],
      [
        'invalid ISO timestamp (non-ISO format)',
        {
          ...valid,
          decisionStartedAt: '08/09/2026 10:00:00',
        },
        /must be valid ISO-8601 timestamps/,
      ],
      [
        'unparseable timestamp',
        {
          ...valid,
          decisionCompletedAt: 'not-a-timestamp',
        },
        /must be valid ISO-8601 timestamps/,
      ],
    ]

    for (const [label, body, expected] of violations) {
      const res = await request(api, {
        method: 'POST',
        url: '/api/projects/proj-core/decision-telemetry',
        headers: { Authorization: `Bearer ${token}` },
        body,
      })
      expect(res.status, label).toBe(400)
      expect(JSON.stringify(res.json), label).toMatch(expected)
    }

    // None of the rejected submissions may have entered the stream.
    const value = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/product-value?workspaceId=${wsId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    const metrics = value.json as {
      measuredDecisionLatencySeconds: { observationCount: number }
      decisionAcceptanceRate: { observationCount: number }
    }
    expect(metrics.measuredDecisionLatencySeconds.observationCount).toBe(1)
    expect(metrics.decisionAcceptanceRate.observationCount).toBe(1)
  })

  it('logout invalidates the session server-side: the token is dead immediately', async () => {
    await api.initApiServer()
    const signup = await request(api, {
      method: 'POST',
      url: '/api/auth/signup',
      body: { email: 'logout@acme.com', password: 'super-secure-password' },
    })
    expect(signup.status).toBe(200)
    const token = signup.json.token as string

    // Session is valid before logout.
    const before = await request(api, {
      method: 'GET',
      url: '/api/auth/session',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(before.status).toBe(200)

    const logout = await request(api, {
      method: 'POST',
      url: '/api/auth/logout',
      headers: { Authorization: `Bearer ${token}` },
      body: {},
    })
    expect(logout.status).toBe(200)

    // The same token must now be rejected — server-side invalidation, not
    // merely client-side localStorage clearing.
    const after = await request(api, {
      method: 'GET',
      url: '/api/auth/session',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(after.status).toBe(401)
  })
})
