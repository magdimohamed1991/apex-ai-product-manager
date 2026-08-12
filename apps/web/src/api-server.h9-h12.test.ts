/**
 * API server integration tests — H9–H12 intelligence routes.
 *
 * Drives the REAL `handleApiRequest` through minimal Node request/response
 * objects, exactly like api-server.test.ts. Covers:
 *   - full happy-path lifecycles for H9 (competitor), H10 (UX), H11
 *     (browser), and H12 (executive) intelligence
 *   - unauthenticated access → 401 on every new route
 *   - cross-workspace ID substitution → 403 on every new route
 *   - per-workspace rate limiting → 429
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const TEST_DB_DIR = path.join(process.cwd(), 'database-api-server-h9-h12-test')

interface ReqOptions {
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
}

function makeRes() {
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
  return { status: res.statusCode, json }
}

type Route = { method: 'GET' | 'POST'; url: string; body?: unknown }

/** Every H9–H12 route, parameterized by project id and workspace id. */
function h9h12Routes(p: string, ws: string): Route[] {
  const query = `workspaceId=${ws}`
  return [
    // H9 competitor intelligence
    { method: 'POST', url: `/api/projects/${p}/competitor-analysis`, body: { workspaceId: ws } },
    { method: 'GET', url: `/api/projects/${p}/competitor-analysis?${query}` },
    {
      method: 'POST',
      url: `/api/projects/${p}/competitors`,
      body: {
        workspaceId: ws,
        name: 'Acme AI',
        slug: 'acme-ai',
        tier: 'direct',
        websiteUrl: 'https://acme.example',
      },
    },
    { method: 'GET', url: `/api/projects/${p}/competitors?${query}` },
    { method: 'GET', url: `/api/projects/${p}/feature-matrix?${query}` },
    { method: 'GET', url: `/api/projects/${p}/positioning-matrix?${query}` },
    { method: 'GET', url: `/api/projects/${p}/differentiation?${query}` },
    { method: 'GET', url: `/api/projects/${p}/market-opportunities?${query}` },
    { method: 'GET', url: `/api/projects/${p}/competitor-recommendations?${query}` },
    // H10 UX intelligence
    { method: 'POST', url: `/api/projects/${p}/ux-analysis`, body: { workspaceId: ws } },
    { method: 'GET', url: `/api/projects/${p}/ux-analysis?${query}` },
    {
      method: 'POST',
      url: `/api/projects/${p}/user-journeys`,
      body: {
        workspaceId: ws,
        name: 'Onboarding',
        description: 'First-run flow',
        completionRate: 0.3,
      },
    },
    { method: 'GET', url: `/api/projects/${p}/user-journeys?${query}` },
    {
      method: 'POST',
      url: `/api/projects/${p}/friction-points`,
      body: {
        workspaceId: ws,
        title: 'Broken submit',
        description: 'Submit does nothing',
        severity: 'critical',
        category: 'form_design',
        estimatedImpact: 'high',
      },
    },
    { method: 'GET', url: `/api/projects/${p}/friction-points?${query}` },
    { method: 'GET', url: `/api/projects/${p}/ux-recommendations?${query}` },
    // H11 browser intelligence
    {
      method: 'POST',
      url: `/api/projects/${p}/crawl`,
      body: {
        workspaceId: ws,
        targets: [{ url: 'https://acme.example/pricing', pageType: 'pricing' }],
        origin: 'user',
      },
    },
    { method: 'GET', url: `/api/projects/${p}/crawl-jobs?${query}` },
    { method: 'GET', url: `/api/projects/${p}/crawled-pages?${query}` },
    { method: 'GET', url: `/api/projects/${p}/browser-session?${query}` },
    // H12 executive intelligence
    { method: 'POST', url: `/api/projects/${p}/executive-dashboard`, body: { workspaceId: ws } },
    { method: 'GET', url: `/api/projects/${p}/executive-dashboard?${query}` },
    {
      method: 'POST',
      url: `/api/projects/${p}/executive-reports`,
      body: { workspaceId: ws, period: 'weekly' },
    },
    { method: 'GET', url: `/api/projects/${p}/executive-reports?${query}` },
    {
      method: 'GET',
      url: `/api/projects/${p}/executive-reports/rep-any/export?${query}&format=json`,
    },
    { method: 'GET', url: `/api/projects/${p}/trends?${query}` },
  ]
}

async function signup(api: typeof import('./api-server'), email: string) {
  const res = await request(api, {
    method: 'POST',
    url: '/api/auth/signup',
    body: { email, password: 'super-secure-password' },
  })
  expect(res.status).toBe(200)
  return {
    token: res.json.token as string,
    workspaceId: (res.json.workspace as { id: string }).id,
  }
}

describe('API server — H9–H12 intelligence routes', () => {
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

  it('H9: competitor registration → analysis → every read endpoint', async () => {
    await api.initApiServer()
    const { token, workspaceId } = await signup(api, 'h9@acme.com')

    const add = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/competitors',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        workspaceId,
        name: 'Alpha',
        slug: 'alpha',
        tier: 'direct',
        websiteUrl: 'https://alpha.example',
      },
    })
    expect(add.status).toBe(200)
    expect((add.json as { id: string }).id).toBeTruthy()

    const run = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/competitor-analysis',
      headers: { Authorization: `Bearer ${token}` },
      body: { workspaceId },
    })
    expect(run.status).toBe(200)
    expect((run.json as { status: string }).status).toBe('completed')

    const analysis = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/competitor-analysis?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(analysis.status).toBe(200)
    expect((analysis.json as { status: string }).status).toBe('completed')

    const matrix = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/feature-matrix?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(matrix.status).toBe(200)
    expect((matrix.json as { features?: unknown[] }).features).toBeDefined()

    const positioning = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/positioning-matrix?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(positioning.status).toBe(200)
    expect((positioning.json as { dimensions?: unknown[] }).dimensions).toBeDefined()

    for (const route of [
      ['differentiation', '/differentiation'],
      ['market-opportunities', '/market-opportunities'],
      ['competitor-recommendations', '/competitor-recommendations'],
    ] as const) {
      const res = await request(api, {
        method: 'GET',
        url: `/api/projects/proj-core${route[1]}?workspaceId=${workspaceId}`,
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status, route[0]).toBe(200)
    }
  })

  it('H10: journey + friction registration → UX analysis → recommendations', async () => {
    await api.initApiServer()
    const { token, workspaceId } = await signup(api, 'h10@acme.com')

    const journey = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/user-journeys',
      headers: { Authorization: `Bearer ${token}` },
      body: { workspaceId, name: 'Onboarding', description: 'First-run flow', completionRate: 0.3 },
    })
    expect(journey.status).toBe(200)

    const friction = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/friction-points',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        workspaceId,
        title: 'Checkout never submits',
        description: 'Clicking submit does nothing',
        severity: 'critical',
        category: 'form_design',
        estimatedImpact: 'high',
      },
    })
    expect(friction.status).toBe(200)

    const run = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/ux-analysis',
      headers: { Authorization: `Bearer ${token}` },
      body: { workspaceId },
    })
    expect(run.status).toBe(200)
    expect((run.json as { status: string }).status).toBe('completed')

    const analysis = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/ux-analysis?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(analysis.status).toBe(200)
    expect((analysis.json as { overallUXScore: number | null }).overallUXScore).not.toBeNull()

    const journeys = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/user-journeys?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect((journeys.json as unknown as unknown[]).length).toBe(1)

    const frictions = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/friction-points?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect((frictions.json as unknown as unknown[]).length).toBe(1)

    const recs = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/ux-recommendations?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect((recs.json as unknown as unknown[]).length).toBeGreaterThan(0)
  })

  it('H11: crawl a target → jobs, pages, and session are persisted', async () => {
    await api.initApiServer()
    const { token, workspaceId } = await signup(api, 'h11@acme.com')

    const crawl = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/crawl',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        workspaceId,
        targets: [{ url: 'https://acme.example/pricing', pageType: 'pricing' }],
        origin: 'user',
      },
    })
    expect(crawl.status).toBe(200)
    expect((crawl.json as { status: string }).status).toBe('completed')
    expect((crawl.json as { respectRobots: boolean }).respectRobots).toBe(true)

    const jobs = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/crawl-jobs?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect((jobs.json as unknown as unknown[]).length).toBe(1)

    const pages = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/crawled-pages?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    const pageList = pages.json as unknown as Array<{ pageType: string; statusCode: number }>
    expect(pageList.length).toBe(1)
    expect(pageList[0].pageType).toBe('pricing')
    expect(pageList[0].statusCode).toBe(200)

    const session = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/browser-session?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect((session.json as { totalPagesCrawled: number }).totalPagesCrawled).toBe(1)
  })

  it('H12: dashboard → trends → weekly report → exports', async () => {
    await api.initApiServer()
    const { token, workspaceId } = await signup(api, 'h12@acme.com')

    const dash = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/executive-dashboard',
      headers: { Authorization: `Bearer ${token}` },
      body: { workspaceId },
    })
    expect(dash.status).toBe(200)
    const dashboard = dash.json as { healthSnapshot: { status: string } | null }
    // No persisted data in this fresh workspace → honest 'unknown' status.
    expect(dashboard.healthSnapshot?.status).toBe('unknown')

    const dashRead = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/executive-dashboard?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(dashRead.status).toBe(200)
    expect((dashRead.json as { dashboard: unknown }).dashboard).toBeTruthy()

    const report = await request(api, {
      method: 'POST',
      url: '/api/projects/proj-core/executive-reports',
      headers: { Authorization: `Bearer ${token}` },
      body: { workspaceId, period: 'weekly' },
    })
    expect(report.status).toBe(200)
    const reportJson = report.json as {
      id: string
      period: string
      markdownExport: string | null
      jsonExport: string | null
    }
    expect(reportJson.period).toBe('weekly')
    expect(reportJson.markdownExport).toContain('Executive Summary')

    const reports = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/executive-reports?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect((reports.json as unknown as unknown[]).length).toBe(1)

    const jsonExport = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/executive-reports/${reportJson.id}/export?workspaceId=${workspaceId}&format=json`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(jsonExport.status).toBe(200)
    const exported = jsonExport.json as { format: string; content: string }
    expect(exported.format).toBe('json')
    expect(JSON.parse(exported.content).period).toBe('weekly')

    const mdExport = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/executive-reports/${reportJson.id}/export?workspaceId=${workspaceId}&format=markdown`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect((mdExport.json as { content: string }).content).toContain('# Executive Report')

    const pdfExport = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/executive-reports/${reportJson.id}/export?workspaceId=${workspaceId}&format=pdf`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect((pdfExport.json as { content: null; note: string }).content).toBeNull()
    expect((pdfExport.json as { note: string }).note).toMatch(/browser runtime/)

    const trends = await request(api, {
      method: 'GET',
      url: `/api/projects/proj-core/trends?workspaceId=${workspaceId}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(Array.isArray(trends.json)).toBe(true)
  })

  it('rejects unauthenticated access on every H9–H12 route with 401', async () => {
    await api.initApiServer()
    const routes = h9h12Routes('proj-core', 'ws-any')

    for (const route of routes) {
      const res = await request(api, { method: route.method, url: route.url, body: route.body })
      expect(res.status, `${route.method} ${route.url}`).toBe(401)
    }
  })

  it('enforces tenant isolation: workspace B cannot touch workspace A data on any H9–H12 route', async () => {
    await api.initApiServer()
    const a = await signup(api, 'h9-a@acme.com')
    const b = await signup(api, 'h9-b@acme.com')

    // Workspace A seeds a project plus competitor + analysis so the data exists.
    const extra = await request(api, {
      method: 'POST',
      url: '/api/projects',
      headers: { Authorization: `Bearer ${a.token}` },
      body: { workspaceId: a.workspaceId, name: 'Isolated Project' },
    })
    expect(extra.status).toBe(200)
    const projA = (extra.json as { id: string }).id

    await request(api, {
      method: 'POST',
      url: `/api/projects/${projA}/competitors`,
      headers: { Authorization: `Bearer ${a.token}` },
      body: {
        workspaceId: a.workspaceId,
        name: 'Secret Competitor',
        slug: 'secret',
        tier: 'direct',
        websiteUrl: 'https://secret.example',
      },
    })
    await request(api, {
      method: 'POST',
      url: `/api/projects/${projA}/competitor-analysis`,
      headers: { Authorization: `Bearer ${a.token}` },
      body: { workspaceId: a.workspaceId },
    })

    // B substitutes A's workspaceId with B's session → every route must 403.
    const routes = h9h12Routes(projA, a.workspaceId)
    for (const route of routes) {
      const res = await request(api, {
        method: route.method,
        url: route.url,
        headers: { Authorization: `Bearer ${b.token}` },
        body: route.body,
      })
      expect(res.status, `${route.method} ${route.url}`).toBe(403)
    }

    // B names B's OWN workspace with A's project id: write routes must 403
    // (service-level ownership verification) and read routes must return
    // empty/null data (no cross-project leakage inside the workspace).
    for (const route of routes) {
      if (route.method === 'POST') {
        const res = await request(api, {
          method: route.method,
          url: route.url.replace(`workspaceId=${a.workspaceId}`, `workspaceId=${b.workspaceId}`),
          headers: { Authorization: `Bearer ${b.token}` },
          body: { ...(route.body as Record<string, unknown>), workspaceId: b.workspaceId },
        })
        expect(res.status, `POST ${route.url}`).toBe(403)
      }
    }

    const reads = [
      ['GET', `/api/projects/${projA}/competitors?workspaceId=${b.workspaceId}`],
      ['GET', `/api/projects/${projA}/competitor-analysis?workspaceId=${b.workspaceId}`],
      ['GET', `/api/projects/${projA}/feature-matrix?workspaceId=${b.workspaceId}`],
      ['GET', `/api/projects/${projA}/ux-analysis?workspaceId=${b.workspaceId}`],
      ['GET', `/api/projects/${projA}/crawl-jobs?workspaceId=${b.workspaceId}`],
      ['GET', `/api/projects/${projA}/crawled-pages?workspaceId=${b.workspaceId}`],
      ['GET', `/api/projects/${projA}/browser-session?workspaceId=${b.workspaceId}`],
      ['GET', `/api/projects/${projA}/executive-dashboard?workspaceId=${b.workspaceId}`],
      ['GET', `/api/projects/${projA}/trends?workspaceId=${b.workspaceId}`],
    ] as const
    for (const [, url] of reads) {
      const res = await request(api, {
        method: 'GET',
        url,
        headers: { Authorization: `Bearer ${b.token}` },
      })
      expect(res.status, url).toBe(200)
      // No tenant A data may appear in B's response.
      expect(JSON.stringify(res.json), url).not.toContain('Secret Competitor')
    }
  })

  it('enforces the per-workspace API rate limit on H9–H12 routes (429)', async () => {
    await api.initApiServer()
    const { token, workspaceId } = await signup(api, 'ratelimit@acme.com')

    const url = `/api/projects/proj-core/competitors?workspaceId=${workspaceId}`
    const statuses: number[] = []
    for (let i = 0; i < 65; i++) {
      const res = await request(api, {
        method: 'GET',
        url,
        headers: { Authorization: `Bearer ${token}` },
      })
      statuses.push(res.status)
    }

    const allowed = statuses.filter((s) => s === 200).length
    const limited = statuses.filter((s) => s === 429).length
    expect(allowed).toBe(60)
    expect(limited).toBe(5)
    expect(statuses[60]).toBe(429)
  })
})
