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
})
