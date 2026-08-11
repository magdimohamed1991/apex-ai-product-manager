/// <reference types="node" />

import type { IncomingMessage, ServerResponse } from 'node:http'
import * as path from 'node:path'
import {
  DurableFileDatabase,
  SqlActionRepository,
  SqlProductRepository,
  SqlRecommendationOutcomeRepository,
  SqlAdaptiveLearningProfileRepository,
  RecommendationOutcomeService,
  ActionApplicationService,
  PipelineActionOrchestrator,
  RepositoryDiscoveryPipeline,
  EnvCredentialProvider,
  APEXProductService,
  ActionExecutor,
  adapterRegistry,
  GitHubAdapter,
  ProductIntelligenceService,
  createWorkspaceId,
  ProductReasoningService,
  AdaptiveProfileCompiler,
  H6PrioritizationCalibrator,
  ProductValidationService,
  Logger,
  AuthService,
  AuthRateLimiter,
  ApiRateLimiter,
  SecureIdGenerator,
  toSafeEnvelope,
  AppError,
  ValidationError,
  NotFoundError,
} from '@apex/ai-core'

import type {
  LLMProvider,
  RichRecommendation,
  Recommendation as ApiRecommendation,
  Recommendation,
  AIProductReasoning,
  UserRecord,
  VerificationEvidence,
  PMDecisionKind,
  RecommendationOutcome,
  LearningSignal,
} from '@apex/ai-core'
import {
  OpenAIResponsesProvider,
  RepositorySummaryProfile,
  SecurityError,
  MockLLMProvider,
  PMDecisionTelemetryService,
} from '@apex/ai-core'
import type { ProviderCredentials } from '@apex/ai-core'

/**
 * The persisted Recommendation rows ARE RichRecommendations: runAnalysis
 * persists the assessAndRank output (pmCategory, assessment, priorityScore,
 * expectedOutcome, rankingReason) for every recommendation.
 *
 * The legacy helper here FABRICATED a rich decoration (`CRITICAL_PRODUCT_RISK`,
 * `priorityScore: 5.0`, all-medium assessment) whenever the fields were
 * missing, and then fed that fabricated input to the LLM. That violated the
 * epistemic contract: the LLM would reason over invented facts.
 *
 * Now: if the persisted row is genuinely missing the decoration, we return
 * null and the API answers with a typed "reasoning unavailable" record
 * instead of inventing input for the model.
 */
function buildRichRecommendationFromPersisted(rec: ApiRecommendation): RichRecommendation | null {
  const r = rec as Partial<RichRecommendation>
  if (
    r.pmCategory &&
    r.assessment &&
    typeof r.priorityScore === 'number' &&
    r.expectedOutcome &&
    typeof r.rankingReason === 'string'
  ) {
    return rec as RichRecommendation
  }
  return null
}

function unavailableReasoning(rec: ApiRecommendation, model: string): AIProductReasoning {
  return {
    recommendationId: rec.id,
    workspaceId: rec.workspaceId,
    model,
    version: 'h4-v2',
    contextHash: '',
    rationale: 'AI reasoning is currently unavailable for this recommendation.',
    impactExplanation:
      'The persisted recommendation is missing its deterministic H3 decoration (category, assessment, priority score). Re-run the analysis pipeline to restore reasoning input, or rely on the deterministic evidence already shown.',
    tradeoffs: ['Reasoning unavailable — proceed with deterministic H3 evidence only'],
    alternatives: [
      {
        label: 'Re-run the repository analysis to regenerate decorated recommendations',
        effort: 'low',
        impact: 'medium',
        description: 'Restores the H3 decoration required as reasoning input.',
      },
    ],
    knowns: [],
    inferences: [],
    unknowns: ['Why is the H3 decoration missing from this recommendation?'],
    clarifyingQuestions: [],
    confidence: 0,
    recommendedDecision: 'Reasoning unavailable — defer to H3 evidence and PM judgment.',
    timestamp: new Date(),
    unavailable: true,
    failureReason: 'schema_violation',
  }
}

/**
 * Development-only mock LLM provider whose canned reasoning is grounded in
 * the actual recommendation id present in the prompt (the id is a grounding
 * keyword per the H4 contract), so the dev flow exercises the full
 * validation/grounding pipeline without an API key. NEVER used in
 * production — the composition root fails hard instead.
 */
class DevReasoningMockProvider extends MockLLMProvider {
  async complete(
    prompt: string,
    options?: Parameters<LLMProvider['complete']>[1]
  ): Promise<Awaited<ReturnType<LLMProvider['complete']>>> {
    void options // LLMOptions are intentionally ignored by the deterministic mock
    const idMatch = prompt.match(/Recommendation ID:\s*(\S+)/)
    const recId = idMatch?.[1] ?? 'unknown-recommendation'
    const response = JSON.stringify({
      rationale: 'This recommendation addresses an observed configuration gap in the repository.',
      impactExplanation:
        'Closing this gap reduces regression risk and stabilizes release velocity.',
      tradeoffs: ['Improves reliability gates', 'Slight setup time'],
      alternatives: [
        {
          label: 'Option A — Standard configuration',
          effort: 'low',
          impact: 'high',
          description: 'Apply the recommended configuration incrementally across the codebase.',
        },
      ],
      knowns: [
        `Recommendation ${recId} was produced by the deterministic analysis pipeline from observed repository evidence.`,
      ],
      inferences: ['Without this change, future regressions are likely to reach production'],
      unknowns: ['Telemetry on production incidents is currently not captured by the system'],
      clarifyingQuestions: ['How frequently does the team deploy to production?'],
      confidence: 0.75,
      recommendedDecision: 'Adopt incrementally with the standard configuration approach.',
    })
    return {
      content: response,
      model: this.model,
      usage: {
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(response.length / 4),
        totalTokens: Math.ceil((prompt.length + response.length) / 4),
      },
      durationMs: 1,
    }
  }
}

// -- Module-scoped state --

let productService: APEXProductService | null = null
let actionRepository: SqlActionRepository | null = null
let productRepository: SqlProductRepository | null = null
let database: DurableFileDatabase | null = null
let authService: AuthService | null = null
let llmProvider: LLMProvider | null = null
let workerInterval: NodeJS.Timeout | null = null

const logger = new Logger('api.server')
const authRateLimiter = new AuthRateLimiter(5, 15 * 60 * 1000)
const apiRateLimiter = new ApiRateLimiter(60, 60 * 1000) // 60 req/min per workspace

// -- HTTP helpers --

const MAX_REQUEST_BODY_BYTES = 1024 * 1024 // 1MB

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(data))
}

function sendError(res: ServerResponse, err: unknown) {
  const { envelope, status } = toSafeEnvelope(err)
  sendJson(res, envelope, status)
}

function checkApiRateLimit(res: ServerResponse, workspaceId: string, endpoint: string): boolean {
  const result = apiRateLimiter.record(`${workspaceId}:${endpoint}`)
  if (!result.allowed) {
    sendJson(res, { error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429)
    return false
  }
  return true
}

function getBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let total = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_REQUEST_BODY_BYTES) {
        req.destroy()
        reject(new ValidationError('Request body exceeds 1MB limit'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (total === 0) {
        resolve({})
        return
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        if (!text.trim()) {
          resolve({})
          return
        }
        resolve(JSON.parse(text) as Record<string, unknown>)
      } catch {
        reject(new ValidationError('Request body is not valid JSON'))
      }
    })
    req.on('error', () => {
      reject(new ValidationError('Request stream error'))
    })
  })
}

function getQueryParam(url: string, param: string): string | null {
  try {
    const parsed = new URL(url, 'http://localhost')
    return parsed.searchParams.get(param)
  } catch {
    return null
  }
}

function getBearerToken(req: IncomingMessage): string | null {
  const authHeader = req.headers['authorization']
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7)
  }
  return null
}

function getSessionToken(req: IncomingMessage): string | null {
  // Custom header support retained for backward compatibility with the
  // existing frontend (apps/web). Bearer is the preferred transport.
  const legacy = req.headers['x-apex-session']
  return getBearerToken(req) || (typeof legacy === 'string' ? legacy : null) || null
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for']
  return (typeof fwd === 'string' ? fwd : undefined) || req.socket?.remoteAddress || 'unknown'
}

interface AuthorizedContext {
  userId: string
  sessionId: string
  workspaceId: string
}

async function authenticateAndAuthorize(
  req: IncomingMessage,
  res: ServerResponse,
  requiredWorkspaceId?: string
): Promise<AuthorizedContext | null> {
  const token = getSessionToken(req)
  if (!token) {
    sendError(res, new AppError({ code: 'AUTHENTICATION_ERROR', message: 'Missing session token' }))
    return null
  }
  const session = await authService!.resolveSession(token)
  if (!session) {
    sendError(
      res,
      new AppError({ code: 'AUTHENTICATION_ERROR', message: 'Session expired or invalid' })
    )
    return null
  }
  const workspaceId = requiredWorkspaceId || session.workspaceId
  if (!workspaceId) {
    sendError(
      res,
      new AppError({ code: 'AUTHORIZATION_ERROR', message: 'No workspace context found' })
    )
    return null
  }
  if (!authService!.isMember(session.userId, workspaceId)) {
    sendError(
      res,
      new AppError({
        code: 'AUTHORIZATION_ERROR',
        message: 'Access denied: not a member of this workspace',
      })
    )
    return null
  }
  return { userId: session.userId, sessionId: session.sessionId, workspaceId }
}

// -- Initialize --

export async function initApiServer() {
  if (productService) return

  const dbDir = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(process.cwd(), 'dev-database')
  database = new DurableFileDatabase(dbDir)
  await database.initialize()

  actionRepository = new SqlActionRepository(database)
  productRepository = new SqlProductRepository(database)
  const outcomeRepository = new SqlRecommendationOutcomeRepository(database)
  const profileRepository = new SqlAdaptiveLearningProfileRepository(database)
  const actionAppService = new ActionApplicationService(actionRepository)
  const pipeline = new RepositoryDiscoveryPipeline()
  const orchestrator = new PipelineActionOrchestrator(pipeline, actionAppService)
  const credentialProvider = new EnvCredentialProvider()

  const outcomeService = new RecommendationOutcomeService(
    outcomeRepository,
    productRepository,
    actionRepository
  )
  const profileCompiler = new AdaptiveProfileCompiler(
    profileRepository,
    productRepository,
    actionRepository,
    outcomeRepository
  )
  const calibrator = new H6PrioritizationCalibrator()
  const validationService = new ProductValidationService(
    productRepository,
    actionRepository,
    outcomeRepository
  )
  const telemetryService = new PMDecisionTelemetryService(productRepository)

  productService = new APEXProductService(
    productRepository,
    actionRepository,
    actionAppService,
    orchestrator,
    credentialProvider,
    new ProductIntelligenceService(),
    outcomeService,
    profileCompiler,
    profileRepository,
    calibrator,
    validationService,
    telemetryService
  )

  authService = new AuthService(
    database,
    async ({ workspaceId, name, slug }: { workspaceId: string; name: string; slug: string }) => {
      try {
        const ws = await productService!.createWorkspace(workspaceId, name, slug)
        return { id: ws.id, name: ws.name, slug: ws.slug }
      } catch {
        return null
      }
    },
    async (workspaceId: string, projectId: string, name: string) => {
      await productService!.createProject(workspaceId, projectId, name)
    }
  )

  // H4 LLM provider selection (composition root).
  //
  // Production (NODE_ENV=production):
  //   - Requires OPENAI_API_KEY. If the key is missing, the server refuses
  //     to start with a mock provider — a hard SecurityError. No fabricated
  //     reasoning can ever be produced in production.
  //   - The OpenAI provider never falls back to a mock internally.
  //
  // Development / test:
  //   - Uses a deterministic DevReasoningMockProvider (clearly labeled
  //     `provider: mock`, `model: mock-v1`) whose canned output is grounded
  //     in the actual recommendation id, so the full H4 validation +
  //     grounding pipeline is exercised without an API key.
  const openAiKey = process.env.OPENAI_API_KEY
  if (openAiKey) {
    llmProvider = new OpenAIResponsesProvider({
      apiKey: openAiKey,
      profile: RepositorySummaryProfile,
      timeoutMs: 30000,
      maxRetries: 2,
    })
  } else if (process.env.NODE_ENV === 'production') {
    throw new SecurityError(
      'OPENAI_API_KEY is not configured. Production reasoning requires a real OpenAI key; refusing to run with a mock LLM provider.'
    )
  } else {
    logger.warn(
      'OPENAI_API_KEY not set — using DevReasoningMockProvider (development only). Production requires a real OpenAI key.'
    )
    llmProvider = new DevReasoningMockProvider()
  }

  // Adapter registry
  adapterRegistry.clear()
  adapterRegistry.register(new GitHubAdapter())
  GitHubAdapter.resetMockState()

  // Pre-seed an onboarding workspace only on a completely fresh database
  // (no users exist) AND outside production. This is a development
  // convenience, NOT a production behavior — production must never
  // pre-seed user data or a demo workspace.
  const isProduction = process.env.NODE_ENV === 'production'
  const users = database.getActiveState().users || []
  if (users.length === 0 && !isProduction) {
    const wsId = 'ws-onboarding-demo'
    const workspaceId = createWorkspaceId(wsId)
    try {
      const existing = await productService.getWorkspace(wsId)
      if (!existing) {
        await productService.createWorkspace(wsId, 'Acme Engineering', 'acme')
        await productService.createProject(wsId, 'proj-core', 'APEX System Core')
        // For the demo seed we register a placeholder membership so the
        // workspace appears in API listings.
        database.beginTransaction()
        try {
          const seedUser: UserRecord = {
            id: 'usr-demo-seed',
            email: 'demo@apex.local',
            passwordHash: 'UNAVAILABLE',
            createdAt: new Date().toISOString(),
          }
          database.insertUser(seedUser)
          database.insertMembership({
            id: 'mbr-demo-seed',
            userId: 'usr-demo-seed',
            workspaceId: wsId,
            role: 'owner',
            createdAt: new Date().toISOString(),
          })
          await database.commit()
        } catch {
          database.rollback()
        }
        logger.info('Seeded development workspace', { workspaceId })
      }
    } catch (err) {
      logger.warn('Demo workspace seed failed (non-fatal)', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Background worker (Milestone I)
  if (workerInterval) clearInterval(workerInterval)
  workerInterval = setInterval(() => {
    void processWorkspaceActions()
  }, 5000)

  logger.info('API server initialized', { port: process.env.PORT || 5173 })
}

/**
 * Stop the background worker and release module-level singletons. Used by
 * tests and by hosting runtimes that need a clean shutdown.
 */
export function shutdownApiServer(): void {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
  }
  productService = null
  actionRepository = null
  productRepository = null
  database = null
  authService = null
  llmProvider = null
}

async function processWorkspaceActions() {
  if (!productService || !actionRepository || !productRepository) return
  try {
    const users = database!.getActiveState().users || []
    const workspaces = new Set<string>()
    for (const u of users) {
      const memberships = database!.getMembershipsForUser(u.id) || []
      for (const m of memberships) workspaces.add(m.workspaceId)
    }
    const credentialProvider = new EnvCredentialProvider()
    const executor = new ActionExecutor(actionRepository)
    for (const wsId of workspaces) {
      const wsIdObj = createWorkspaceId(wsId)
      // Discover pending work BEFORE fetching credentials: with no pending
      // actions there is nothing to execute and no reason to touch the
      // credential provider (in production a missing GITHUB_TOKEN previously
      // aborted the whole iteration every 5 seconds, flooding the logs).
      const pending = await actionRepository.getPendingActionsAndWorkspace(wsIdObj)
      if (pending.length === 0) continue
      let creds: ProviderCredentials
      try {
        creds = await credentialProvider.getCredentials(wsIdObj, 'github')
      } catch (err) {
        // Per-workspace credential failure (e.g. GITHUB_TOKEN unset in
        // production): log once and skip this workspace; other workspaces
        // must still be processed and the loop must not crash.
        logger.warn('Worker credential lookup failed; skipping workspace', {
          workspaceId: wsId,
          err: err instanceof Error ? err.message : String(err),
        })
        continue
      }
      for (const action of pending) {
        try {
          // H8-ACTION-1: Workspace-only lookup is intentional here — the
          // background worker iterates all pending actions in a workspace.
          // The action already belongs to this workspace; the recommendation
          // lookup is for extracting the projectId to resolve the repository
          // connection. The workspace scope is sufficient because the action
          // was created from this workspace's recommendation pipeline.
          const rec = await productRepository.getRecommendationByIdAndWorkspace(
            action.relatedRecommendationId,
            wsIdObj
          )
          const projectId = (rec as (Recommendation & { projectId?: string }) | null)?.projectId
          const conn = projectId
            ? await productRepository.getRepositoryConnectionByProject(projectId, wsIdObj)
            : null
          const context = {
            workspaceId: wsIdObj,
            credentials: {
              token: creds.token,
              owner: conn?.owner || '',
              repository: conn?.repository || '',
            },
          }
          await executor.execute(action.id, wsIdObj, context)
        } catch (err) {
          logger.warn('Worker action failed', {
            actionId: action.id,
            err: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
  } catch (err) {
    logger.error('Background worker iteration failed', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// -- Routing --

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = req.url || ''
  const method = req.method || 'GET'
  const pathname = url.split('?')[0]

  // Per-request correlation ID
  const reqIdHeader = req.headers['x-request-id']
  const requestId =
    (typeof reqIdHeader === 'string' ? reqIdHeader : undefined) || SecureIdGenerator.token(8)
  if (typeof res.setHeader === 'function') res.setHeader('X-Request-Id', requestId)

  // Dispatch inside the async-local request context so every structured log
  // line emitted while handling this request carries the correlation ID.
  // The service-null guard lives INSIDE the closure so TypeScript narrowing
  // applies to every route below.
  const dispatch = async (): Promise<boolean> => {
    await initApiServer()
    if (!productService || !productRepository || !authService) {
      sendError(res, new Error('Service not initialized'))
      return true
    }

    // -- Auth endpoints (public) --

    if (pathname === '/api/auth/signup' && method === 'POST') {
      const ip = clientIp(req)
      const limited = authRateLimiter.check(`signup:${ip}`)
      if (!limited.allowed) {
        sendError(
          res,
          new AppError({ code: 'PROVIDER_RATE_LIMIT_ERROR', message: 'Too many signup attempts' })
        )
        return true
      }
      const body = await getBody(req)
      try {
        const result = await authService.signup({
          email: String(body?.email || ''),
          password: String(body?.password || ''),
          workspaceName: body?.workspaceName ? String(body.workspaceName) : undefined,
          workspaceSlug: body?.workspaceSlug ? String(body.workspaceSlug) : undefined,
        })
        authRateLimiter.recordSuccess(`signup:${ip}`)
        sendJson(res, {
          token: result.sessionId,
          user: result.user,
          workspace: result.workspaces[0] || null,
        })
      } catch (err) {
        // Failed signup attempts (invalid email, duplicate account, weak
        // password, …) count toward the per-IP brute-force budget, exactly
        // like failed logins. Previously only successes were recorded, so
        // the limiter never engaged for signup abuse.
        authRateLimiter.recordFailure(`signup:${ip}`)
        throw err
      }
      return true
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const ip = clientIp(req)
      const limited = authRateLimiter.check(`login:${ip}`)
      if (!limited.allowed) {
        sendError(
          res,
          new AppError({ code: 'PROVIDER_RATE_LIMIT_ERROR', message: 'Too many login attempts' })
        )
        return true
      }
      const body = await getBody(req)
      try {
        const result = await authService.login(
          String(body?.email || ''),
          String(body?.password || '')
        )
        authRateLimiter.recordSuccess(`login:${ip}`)
        sendJson(res, {
          token: result.sessionId,
          user: result.user,
          workspace: result.workspaces[0] || null,
        })
      } catch (err) {
        authRateLimiter.recordFailure(`login:${ip}`)
        throw err
      }
      return true
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      const token = getSessionToken(req)
      if (token) await authService.logout(token)
      sendJson(res, { success: true })
      return true
    }

    if (pathname === '/api/auth/session' && method === 'GET') {
      const token = getSessionToken(req)
      if (!token) {
        sendError(
          res,
          new AppError({ code: 'AUTHENTICATION_ERROR', message: 'Authentication required' })
        )
        return true
      }
      const session = await authService.resolveSession(token)
      if (!session) {
        sendError(
          res,
          new AppError({ code: 'AUTHENTICATION_ERROR', message: 'Session expired or invalid' })
        )
        return true
      }
      const user = database?.getUserById(session.userId)
      if (!user) {
        sendError(res, new AppError({ code: 'AUTHENTICATION_ERROR', message: 'User not found' }))
        return true
      }
      sendJson(res, {
        user: { id: user.id, email: user.email },
        workspaces: authService.listWorkspacesForUser(user.id),
      })
      return true
    }

    // -- Workspaces --

    if (pathname === '/api/workspaces' && method === 'GET') {
      const token = getSessionToken(req)
      if (!token) {
        sendError(
          res,
          new AppError({ code: 'AUTHENTICATION_ERROR', message: 'Authentication required' })
        )
        return true
      }
      const session = await authService.resolveSession(token)
      if (!session) {
        sendError(
          res,
          new AppError({ code: 'AUTHENTICATION_ERROR', message: 'Session expired or invalid' })
        )
        return true
      }
      const ws = authService.listWorkspacesForUser(session.userId)
      sendJson(res, ws)
      return true
    }

    if (pathname === '/api/workspaces' && method === 'POST') {
      const auth = await authenticateAndAuthorize(req, res)
      if (!auth) return true
      const body = await getBody(req)
      const name = String(body?.name || '').trim()
      if (!name) {
        sendError(res, new ValidationError('Missing name'))
        return true
      }
      // The workspace id is ALWAYS generated server-side. Client-supplied
      // ids are ignored so tenants can never collide with (or overwrite)
      // another workspace's id space.
      const id = `ws-${SecureIdGenerator.token(8)}`
      const slug =
        String(body?.slug || name)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'workspace'
      const ws = await productService.createWorkspace(id, name, slug)
      // Grant membership to creator
      database!.beginTransaction()
      try {
        database!.insertMembership({
          id: `mbr-${SecureIdGenerator.token(12)}`,
          userId: auth.userId,
          workspaceId: id,
          role: 'owner',
          createdAt: new Date().toISOString(),
        })
        await database!.commit()
      } catch (err) {
        database!.rollback()
        throw err
      }
      sendJson(res, { id: ws.id, name: ws.name, slug: ws.slug })
      return true
    }

    // -- Projects --

    if (pathname === '/api/projects' && method === 'GET') {
      const workspaceId = getQueryParam(url, 'workspaceId')
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      const projects = await productService.getProjects(auth.workspaceId)
      sendJson(res, projects)
      return true
    }

    if (pathname === '/api/projects' && method === 'POST') {
      const body = await getBody(req)
      const workspaceId = String(body?.workspaceId || '')
      const auth = await authenticateAndAuthorize(req, res, workspaceId)
      if (!auth) return true
      const name = String(body?.name || '').trim()
      if (!name) {
        sendError(res, new ValidationError('Missing name'))
        return true
      }
      // The project id is ALWAYS generated server-side; client-supplied ids
      // are ignored (prevents cross-tenant id collisions/overwrites).
      const id = `proj-${SecureIdGenerator.token(8)}`
      const proj = await productService.createProject(auth.workspaceId, id, name)
      sendJson(res, proj)
      return true
    }

    // -- Repository connection --

    const repoMatch = pathname.match(/^\/api\/projects\/([^/]+)\/repository$/)
    if (repoMatch && method === 'GET') {
      const projectId = repoMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      const conn = await productService.getRepositoryConnection(auth.workspaceId, projectId)
      sendJson(res, conn || { status: 'not_connected' })
      return true
    }
    if (repoMatch && method === 'POST') {
      const projectId = repoMatch[1]
      const body = await getBody(req)
      const workspaceId = String(body?.workspaceId || '')
      const auth = await authenticateAndAuthorize(req, res, workspaceId)
      if (!auth) return true
      const provider = String(body?.provider || '')
      const owner = String(body?.owner || '')
      const repository = String(body?.repository || '')
      const defaultBranch = String(body?.defaultBranch || '')
      if (!provider || !owner || !repository || !defaultBranch) {
        sendError(res, new ValidationError('Missing required fields'))
        return true
      }
      if (provider !== 'github') {
        sendError(res, new ValidationError('Only github provider is currently supported'))
        return true
      }
      const conn = await productService.connectRepository(auth.workspaceId, projectId, {
        provider: 'github',
        owner,
        repository,
        defaultBranch,
      })
      sendJson(res, conn)
      return true
    }

    // -- Analysis --

    const analysisMatch = pathname.match(/^\/api\/projects\/([^/]+)\/analysis$/)
    if (analysisMatch && method === 'POST') {
      const projectId = analysisMatch[1]
      const body = await getBody(req)
      const workspaceId = String(body?.workspaceId || '')
      const auth = await authenticateAndAuthorize(req, res, workspaceId)
      if (!auth) return true
      const run = await productService.runAnalysis(auth.workspaceId, projectId)
      sendJson(res, run)
      return true
    }

    // -- Findings & Recommendations --

    const findingsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/findings$/)
    if (findingsMatch && method === 'GET') {
      const projectId = findingsMatch[1]
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
        sendError(res, new ValidationError('Invalid project ID format'))
        return true
      }
      const workspaceId = getQueryParam(url, 'workspaceId')
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      if (!checkApiRateLimit(res, auth.workspaceId, 'findings')) return true
      sendJson(res, await productService.getFindings(auth.workspaceId, projectId))
      return true
    }
    const recsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/recommendations$/)
    if (recsMatch && method === 'GET') {
      const projectId = recsMatch[1]
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
        sendError(res, new ValidationError('Invalid project ID format'))
        return true
      }
      const workspaceId = getQueryParam(url, 'workspaceId')
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      if (!checkApiRateLimit(res, auth.workspaceId, 'recommendations')) return true
      sendJson(res, await productService.getRecommendations(auth.workspaceId, projectId))
      return true
    }

    // -- Actions --

    // Approval promotes a ProposedAction (which does not exist as an Action
    // row yet), so the route carries no action id in the URL. The legacy
    // `/api/actions/approve-id/approve` path was a placeholder segment that
    // was parsed but ignored; it is replaced by this canonical route.
    const approveMatch = pathname === '/api/actions/approve' && method === 'POST'
    if (approveMatch) {
      const body = await getBody(req)
      const workspaceId = String(body?.workspaceId || '')
      const projectId = String(body?.projectId || '')
      const auth = await authenticateAndAuthorize(req, res, workspaceId)
      if (!auth) return true
      const recommendationId = String(body?.recommendationId || '')
      const proposedActionId = String(body?.proposedActionId || '')
      if (!projectId || !recommendationId || !proposedActionId) {
        sendError(res, new ValidationError('Missing required fields'))
        return true
      }
      const action = await productService.approveAction(
        auth.workspaceId,
        projectId,
        recommendationId,
        proposedActionId
      )
      sendJson(res, action)
      return true
    }
    const execsMatch = pathname.match(/^\/api\/actions\/([^/]+)\/executions$/)
    if (execsMatch && method === 'GET') {
      const actionId = execsMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      const projectId = getQueryParam(url, 'projectId')
      if (!projectId) {
        sendError(res, new ValidationError('Missing projectId'))
        return true
      }
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      const action = await productService.getAction(auth.workspaceId, projectId, actionId)
      if (!action) {
        sendError(res, new NotFoundError('Action not found'))
        return true
      }
      sendJson(res, await productService.getExecutions(auth.workspaceId, projectId, actionId))
      return true
    }
    const actionMatch = pathname.match(/^\/api\/actions\/([^/]+)$/)
    if (actionMatch && method === 'GET') {
      const actionId = actionMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      const projectId = getQueryParam(url, 'projectId')
      if (!projectId) {
        sendError(res, new ValidationError('Missing projectId'))
        return true
      }
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      const action = await productService.getAction(auth.workspaceId, projectId, actionId)
      sendJson(res, action || null, action ? 200 : 404)
      return true
    }

    // -- Activity / Decisions / Outcomes --

    const activityMatch = pathname.match(/^\/api\/projects\/([^/]+)\/activity$/)
    if (activityMatch && method === 'GET') {
      const projectId = activityMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      sendJson(res, await productService.getActivityLog(auth.workspaceId, projectId))
      return true
    }
    const metricsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/decision-metrics$/)
    if (metricsMatch && method === 'GET') {
      const projectId = metricsMatch[1]
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
        sendError(res, new ValidationError('Invalid project ID format'))
        return true
      }
      const workspaceId = getQueryParam(url, 'workspaceId')
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      if (!checkApiRateLimit(res, auth.workspaceId, 'metrics')) return true
      sendJson(res, await productService.getDecisionQualityMetrics(auth.workspaceId, projectId))
      return true
    }
    const outcomesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/outcomes$/)
    if (outcomesMatch && method === 'GET') {
      const projectId = outcomesMatch[1]
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
        sendError(res, new ValidationError('Invalid project ID format'))
        return true
      }
      const workspaceId = getQueryParam(url, 'workspaceId')
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      if (!checkApiRateLimit(res, auth.workspaceId, 'outcomes')) return true
      sendJson(res, await productService.getOutcomesByProject(auth.workspaceId, projectId))
      return true
    }

    if (pathname === '/api/outcomes/verify' && method === 'POST') {
      const body = await getBody(req)
      const workspaceId = String(body?.workspaceId || '')
      const auth = await authenticateAndAuthorize(req, res, workspaceId)
      if (!auth) return true
      const outcomeId = String(body?.outcomeId || '')
      const projectId = String(body?.projectId || '')
      const filesAfterChange = body?.filesAfterChange
      if (!outcomeId || !projectId || !filesAfterChange || typeof filesAfterChange !== 'object') {
        sendError(res, new ValidationError('Missing outcomeId, projectId or filesAfterChange'))
        return true
      }
      sendJson(
        res,
        await productService.verifyOutcome(
          outcomeId,
          auth.workspaceId,
          projectId,
          filesAfterChange as VerificationEvidence
        )
      )
      return true
    }
    if (pathname === '/api/outcomes/create' && method === 'POST') {
      const body = await getBody(req)
      const workspaceId = String(body?.workspaceId || '')
      const auth = await authenticateAndAuthorize(req, res, workspaceId)
      if (!auth) return true
      const projectId = String(body?.projectId || '')
      const recommendationId = String(body?.recommendationId || '')
      const actionId = body?.actionId ? String(body.actionId) : undefined
      const executionId = body?.executionId ? String(body.executionId) : undefined
      if (!projectId || !recommendationId) {
        sendError(res, new ValidationError('Missing projectId or recommendationId'))
        return true
      }
      sendJson(
        res,
        await productService.createOutcome(
          recommendationId,
          auth.workspaceId,
          projectId,
          actionId,
          executionId
        )
      )
      return true
    }

    const telemetryMatch = pathname.match(/^\/api\/projects\/([^/]+)\/decision-telemetry$/)
    if (telemetryMatch && method === 'POST') {
      const projectId = telemetryMatch[1]
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
        sendError(res, new ValidationError('Invalid project ID format'))
        return true
      }
      const body = await getBody(req)
      const workspaceId = String(body?.workspaceId || '')
      const auth = await authenticateAndAuthorize(req, res, workspaceId)
      if (!auth) return true
      const recommendationId = String(body?.recommendationId || '')
      const decision = String(body?.decision || '')
      if (!recommendationId || !['ACCEPT', 'REJECT', 'DEFER', 'OVERRIDE'].includes(decision)) {
        sendError(res, new ValidationError('Missing recommendationId or invalid decision kind'))
        return true
      }
      // Strict ISO-8601 parsing for ALL client-supplied telemetry
      // timestamps. `new Date()` in JS accepts non-ISO formats (e.g.
      // '08/09/2026', 'August 9 2026', numeric strings) which would let
      // ambiguous or fabricated timestamps into the measurement stream.
      // Telemetry windows must be unambiguous ISO-8601 (with timezone) or
      // the submission is REJECTED — timestamps are never repaired.
      const toDate = (v: unknown): Date | null => {
        if (typeof v !== 'string') return null
        const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
        if (!ISO_8601.test(v)) return null
        const d = new Date(v)
        return Number.isNaN(d.getTime()) ? null : d
      }
      const decisionStartedAt = toDate(body?.decisionStartedAt)
      const decisionCompletedAt = toDate(body?.decisionCompletedAt)
      const recommendationPresentedAt = toDate(body?.recommendationPresentedAt)
      if (!decisionStartedAt || !decisionCompletedAt || !recommendationPresentedAt) {
        sendError(
          res,
          new ValidationError(
            'decisionStartedAt, decisionCompletedAt, and recommendationPresentedAt must be valid ISO-8601 timestamps'
          )
        )
        return true
      }
      // Telemetry window invariant: presentedAt <= startedAt <= completedAt.
      // Violations are REJECTED, never silently repaired (measurement
      // integrity requires the raw window to be honest).
      if (recommendationPresentedAt.getTime() > decisionStartedAt.getTime()) {
        sendError(
          res,
          new ValidationError(
            'recommendationPresentedAt must not follow decisionStartedAt (presentation must precede the decision window)'
          )
        )
        return true
      }
      if (decisionCompletedAt.getTime() < decisionStartedAt.getTime()) {
        sendError(
          res,
          new ValidationError('decisionCompletedAt must not precede decisionStartedAt')
        )
        return true
      }

      // Server-side telemetry integrity checks (Part 5 — clock skew policy).
      // Client timestamps are labeled `client-observed telemetry` and must
      // pass basic sanity checks before entering the measurement stream.
      const serverNow = Date.now()
      const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000 // 5 minutes
      const MAX_DECISION_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours

      // Reject timestamps more than 5 minutes in the future. The policy is
      // applied CONSISTENTLY to all three client timestamps.
      const futureSkewPart = (label: string, d: Date | null): string | null => {
        if (!d) return null
        if (d.getTime() > serverNow + MAX_CLOCK_SKEW_MS) {
          return `${label} is more than 5 minutes in the future; clock skew exceeds allowed tolerance`
        }
        return null
      }
      for (const [label, d] of [
        ['recommendationPresentedAt', recommendationPresentedAt],
        ['decisionStartedAt', decisionStartedAt],
        ['decisionCompletedAt', decisionCompletedAt],
      ] as const) {
        const violation = futureSkewPart(label, d)
        if (violation) {
          sendError(res, new ValidationError(violation))
          return true
        }
      }

      // Reject unreasonably large durations (> 24 hours).
      const durationMs = decisionCompletedAt.getTime() - decisionStartedAt.getTime()
      if (durationMs > MAX_DECISION_DURATION_MS) {
        sendError(
          res,
          new ValidationError(
            `Decision duration ${Math.round(durationMs / 1000 / 60)} minutes exceeds maximum allowed (24 hours)`
          )
        )
        return true
      }

      const pmSelectedPriority =
        typeof body?.pmSelectedPriority === 'number' && Number.isFinite(body.pmSelectedPriority)
          ? (body.pmSelectedPriority as number)
          : undefined
      const apexRank = typeof body?.apexRank === 'number' ? (body.apexRank as number) : undefined
      const pmRank = typeof body?.pmRank === 'number' ? (body.pmRank as number) : undefined
      const recorded = await productService.recordPMDecision({
        workspaceId: auth.workspaceId,
        projectId,
        recommendationId,
        decision: decision as PMDecisionKind,
        decisionStartedAt,
        decisionCompletedAt,
        recommendationPresentedAt,
        pmSelectedPriority,
        apexRank,
        pmRank,
      })
      sendJson(res, recorded)
      return true
    }

    // -- H6 / H7 --

    const compileProfileMatch = pathname.match(/^\/api\/projects\/([^/]+)\/compile-profile$/)
    if (compileProfileMatch && method === 'POST') {
      const projectId = compileProfileMatch[1]
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
        sendError(res, new ValidationError('Invalid project ID format'))
        return true
      }
      const body = await getBody(req)
      const workspaceId = String(body?.workspaceId || '')
      const auth = await authenticateAndAuthorize(req, res, workspaceId)
      if (!auth) return true
      if (!checkApiRateLimit(res, auth.workspaceId, 'compile-profile')) return true
      sendJson(res, await productService.compileAdaptiveProfile(auth.workspaceId, projectId))
      return true
    }
    const profileMatch = pathname.match(/^\/api\/projects\/([^/]+)\/profile$/)
    if (profileMatch && method === 'GET') {
      const projectId = profileMatch[1]
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
        sendError(res, new ValidationError('Invalid project ID format'))
        return true
      }
      const workspaceId = getQueryParam(url, 'workspaceId')
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      if (!checkApiRateLimit(res, auth.workspaceId, 'profile')) return true
      const profile = await productService.getAdaptiveProfile(auth.workspaceId, projectId)
      sendJson(res, profile || null, profile ? 200 : 404)
      return true
    }
    const signalsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/learning-signals$/)
    if (signalsMatch && method === 'GET') {
      const projectId = signalsMatch[1]
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
        sendError(res, new ValidationError('Invalid project ID format'))
        return true
      }
      const workspaceId = getQueryParam(url, 'workspaceId')
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      if (!checkApiRateLimit(res, auth.workspaceId, 'signals')) return true
      sendJson(res, await productService.getLearningSignals(auth.workspaceId, projectId))
      return true
    }
    const calibrationMatch = pathname.match(/^\/api\/recommendations\/([^/]+)\/calibration$/)
    if (calibrationMatch && method === 'GET') {
      const recId = calibrationMatch[1]
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recId)) {
        sendError(res, new ValidationError('Invalid recommendation ID format'))
        return true
      }
      const workspaceId = getQueryParam(url, 'workspaceId')
      const projectId = getQueryParam(url, 'projectId')
      if (!workspaceId || !projectId) {
        sendError(res, new ValidationError('Missing workspaceId or projectId'))
        return true
      }
      const auth = await authenticateAndAuthorize(req, res, workspaceId)
      if (!auth) return true
      if (!checkApiRateLimit(res, auth.workspaceId, 'calibration')) return true
      sendJson(res, await productService.getPriorityCalibration(auth.workspaceId, projectId, recId))
      return true
    }
    const valMatch = pathname.match(/^\/api\/projects\/([^/]+)\/product-value$/)
    if (valMatch && method === 'GET') {
      const projectId = valMatch[1]
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
        sendError(res, new ValidationError('Invalid project ID format'))
        return true
      }
      const workspaceId = getQueryParam(url, 'workspaceId')
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      if (!checkApiRateLimit(res, auth.workspaceId, 'product-value')) return true
      sendJson(res, await productService.getProductValidationMetrics(auth.workspaceId, projectId))
      return true
    }

    // -- H8 Project Stats --

    const statsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/stats$/)
    if (statsMatch && method === 'GET') {
      const projectId = statsMatch[1]
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) {
        sendError(res, new ValidationError('Invalid project ID format'))
        return true
      }
      const workspaceId = getQueryParam(url, 'workspaceId')
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      if (!checkApiRateLimit(res, auth.workspaceId, 'stats')) return true
      const wsId = createWorkspaceId(auth.workspaceId)

      const [recs, outcomes, profile, signals, conn] = await Promise.all([
        productService.getRecommendations(auth.workspaceId, projectId),
        productService.getOutcomesByProject(auth.workspaceId, projectId),
        productService.getAdaptiveProfile(auth.workspaceId, projectId),
        productService.getLearningSignals(auth.workspaceId, projectId),
        productService.getRepositoryConnection(auth.workspaceId, projectId),
      ])

      const pipelineRuns = await productRepository.getPipelineRunsByProject(projectId, wsId)
      const latestRun =
        pipelineRuns.length > 0
          ? pipelineRuns.sort(
              (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
            )[0]
          : null

      const recByPriority = { critical: 0, high: 0, medium: 0, low: 0 }
      for (const r of recs) {
        recByPriority[r.priority as keyof typeof recByPriority]++
      }

      sendJson(res, {
        project: {
          id: projectId,
          name: conn ? `${conn.owner}/${conn.repository}` : projectId,
          status: conn?.status || 'not_connected',
          latestAnalysis: latestRun
            ? {
                status: latestRun.status,
                startedAt: latestRun.startedAt,
                completedAt: latestRun.completedAt,
                error: latestRun.error,
              }
            : null,
        },
        recommendations: {
          total: recs.length,
          byPriority: recByPriority,
        },
        outcomes: {
          total: outcomes.length,
          verified: outcomes.filter((o: RecommendationOutcome) => o.status === 'VERIFIED_SUCCESS')
            .length,
          failed: outcomes.filter((o: RecommendationOutcome) => o.status === 'FAILED').length,
          pending: outcomes.filter((o: RecommendationOutcome) => o.status === 'PENDING').length,
        },
        learning: {
          profileStatus: profile ? 'active' : 'not_compiled',
          totalDecisionsObserved: profile?.totalDecisionsObserved || 0,
          signalCount: signals.length,
          evidenceState:
            signals.length === 0
              ? 'no_data'
              : signals.some((s: LearningSignal) => s.observationCount < 5)
                ? 'early'
                : signals.some((s: LearningSignal) => s.observationCount < 20)
                  ? 'limited'
                  : 'established',
          favoredCategories: profile?.PMPreferences?.favoredCategories || [],
          ignoredCategories: profile?.PMPreferences?.ignoredCategories || [],
        },
      })
      return true
    }

    // -- H4 Reasoning --

    const reasoningMatch = pathname.match(/^\/api\/recommendations\/([^/]+)\/reasoning$/)
    if (reasoningMatch && method === 'GET') {
      const recId = reasoningMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      const projectId = getQueryParam(url, 'projectId')
      if (!projectId) {
        sendError(res, new ValidationError('Missing projectId'))
        return true
      }
      const auth = await authenticateAndAuthorize(req, res, workspaceId || undefined)
      if (!auth) return true
      const wsId = createWorkspaceId(auth.workspaceId)
      const rec = await productRepository.getRecommendationByIdWorkspaceAndProject(
        recId,
        wsId,
        projectId
      )
      if (!rec) {
        sendError(res, new NotFoundError('Recommendation not found'))
        return true
      }
      const rich = buildRichRecommendationFromPersisted(rec)
      if (!rich) {
        // The persisted row is missing its H3 decoration. Answer with a
        // typed "unavailable" record — NEVER fabricate decoration.
        const unavailable = { ...unavailableReasoning(rec, llmProvider!.model), projectId }
        await productRepository.saveAIProductReasoning(unavailable)
        sendJson(res, unavailable)
        return true
      }
      const reasoningService = new ProductReasoningService(productRepository, llmProvider!)
      let reasoning = await productRepository.getAIProductReasoningByWorkspaceAndProject(
        recId,
        wsId,
        projectId
      )
      if (!reasoning) {
        reasoning = await reasoningService.generateReasoning(rich)
      }
      sendJson(res, reasoning)
      return true
    }
    if (reasoningMatch && method === 'POST') {
      const recId = reasoningMatch[1]
      const body = await getBody(req)
      const workspaceId = String(body?.workspaceId || '')
      const auth = await authenticateAndAuthorize(req, res, workspaceId)
      if (!auth) return true
      const projectId = String(body?.projectId || '')
      if (!projectId) {
        sendError(res, new ValidationError('Missing projectId'))
        return true
      }
      const projectContext = body?.projectContext ? String(body.projectContext) : undefined
      const wsId = createWorkspaceId(auth.workspaceId)
      const rec = await productRepository.getRecommendationByIdWorkspaceAndProject(
        recId,
        wsId,
        projectId
      )
      if (!rec) {
        sendError(res, new NotFoundError('Recommendation not found'))
        return true
      }
      const rich = buildRichRecommendationFromPersisted(rec)
      if (!rich) {
        const unavailable = { ...unavailableReasoning(rec, llmProvider!.model), projectId }
        await productRepository.saveAIProductReasoning(unavailable)
        sendJson(res, unavailable)
        return true
      }
      const reasoningService = new ProductReasoningService(productRepository, llmProvider!)
      const reasoning = await reasoningService.generateReasoning(rich, projectContext)
      sendJson(res, reasoning)
      return true
    }

    // No matching route
    sendError(res, new NotFoundError('Route not found'))
    return true
  }

  try {
    return await Logger.withRequestId(requestId, dispatch)
  } catch (err) {
    logger.error('API request failed', { err: err instanceof Error ? err.message : String(err) })
    if (err instanceof AppError) {
      sendError(res, err)
    } else {
      sendError(res, new Error('Internal server error'))
    }
    return true
  }
}
