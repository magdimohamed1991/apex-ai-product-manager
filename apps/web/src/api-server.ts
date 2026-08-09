/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="node" />

import * as path from 'path'
import {
  DurableFileDatabase,
  SqlActionRepository,
  SqlProductRepository,
  SqlRecommendationOutcomeRepository,
  RecommendationOutcomeService,
  ActionApplicationService,
  PipelineActionOrchestrator,
  RepositoryDiscoveryPipeline,
  EnvCredentialProvider,
  APEXProductService,
  ActionExecutor,
  ActionExecutionWorker,
  adapterRegistry,
  GitHubAdapter,
  ProductIntelligenceService,
  createWorkspaceId,
  MockLLMProvider,
  ProductReasoningService,
  SqlAdaptiveLearningProfileRepository,
  AdaptiveProfileCompiler,
  H6PrioritizationCalibrator
} from '@apex/ai-core'

let productService: APEXProductService | null = null
let actionRepository: SqlActionRepository | null = null
let productRepository: SqlProductRepository | null = null
let worker: ActionExecutionWorker | null = null
let credentialProvider: EnvCredentialProvider | null = null

// Initialize database and services
export async function initApiServer() {
  if (productService) return

  const dbDir = path.join(process.cwd(), 'dev-database')
  const database = new DurableFileDatabase(dbDir)
  await database.initialize()

  actionRepository = new SqlActionRepository(database)
  productRepository = new SqlProductRepository(database)
  const outcomeRepository = new SqlRecommendationOutcomeRepository(database)
  const profileRepository = new SqlAdaptiveLearningProfileRepository(database)
  const actionAppService = new ActionApplicationService(actionRepository)
  const pipeline = new RepositoryDiscoveryPipeline()
  const orchestrator = new PipelineActionOrchestrator(pipeline, actionAppService)
  credentialProvider = new EnvCredentialProvider()

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
    calibrator
  )

  const executor = new ActionExecutor(actionRepository)
  worker = new ActionExecutionWorker(actionRepository, executor)

  // Register adapters
  adapterRegistry.clear()
  adapterRegistry.register(new GitHubAdapter())
  GitHubAdapter.mockExternalIssues.clear()

  // Pre-seed a default workspace and project if empty to make the experience instantly beautiful (Item 3 & Item 24)
  const workspaces = await productService.getAllWorkspaces()
  if (workspaces.length === 0) {
    await productService.createWorkspace('ws-default', 'Acme Engineering', 'acme')
    await productService.createProject('ws-default', 'proj-core', 'APEX System Core')
    await productService.connectRepository('ws-default', 'proj-core', {
      provider: 'github',
      owner: 'magdimohamed1991',
      repository: 'apex-ai-product-manager', // Point to our actual monorepo itself! Real file discovery! (Item 6)
      defaultBranch: 'arena/019fe224-apex-ai-product-manager',
    })
    console.log('[API Server] Pre-seeded default workspace and connected local repository.')
  }

  // Start Background Worker Polling Loop (Item 11 & Item 15)
  setInterval(async () => {
    try {
      if (!productService || !worker || !credentialProvider || !actionRepository || !productRepository) return
      const wsList = await productService.getAllWorkspaces()
      for (const ws of wsList) {
        const creds = await credentialProvider.getCredentials(ws.id, 'github')
        
        // Load pending actions
        const pending = await actionRepository.getPendingActionsAndWorkspace(ws.id)
        for (const action of pending) {
          const rec = await productRepository.getRecommendationByIdAndWorkspace(action.relatedRecommendationId, ws.id)
          const projectId = (rec as any)?.projectId
          const conn = await productRepository.getRepositoryConnectionByProject(projectId, ws.id)
          
          const context = {
            workspaceId: ws.id,
            credentials: {
              token: creds.token,
              owner: conn?.owner || 'mock-owner',
              repository: conn?.repository || 'mock-repo',
            }
          }
          await executor.execute(action.id, ws.id, context)
        }
      }
    } catch (err) {
      console.error('[Worker Error] Background execution failed:', err)
    }
  }, 3000)

  console.log('[API Server] Initialized. Background Action Worker started (polling every 3s).')
}

// Helpers
function getBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: any) => { body += chunk })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        resolve({})
      }
    })
  })
}

function sendJson(res: any, data: any, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function getQueryParam(url: string, param: string): string | null {
  try {
    const parsed = new URL(url, 'http://localhost')
    return parsed.searchParams.get(param)
  } catch {
    return null
  }
}

// Main Request Handler middleware
export async function handleApiRequest(req: any, res: any): Promise<boolean> {
  await initApiServer()
  if (!productService || !productRepository) {
    sendJson(res, { error: 'Service not initialized' }, 500)
    return true
  }

  const url = req.url || ''
  const method = req.method || 'GET'
  const pathname = url.split('?')[0]

  try {
    // 1. GET /api/workspaces
    if (pathname === '/api/workspaces' && method === 'GET') {
      const workspaces = await productService.getAllWorkspaces()
      sendJson(res, workspaces)
      return true
    }

    // 2. POST /api/workspaces
    if (pathname === '/api/workspaces' && method === 'POST') {
      const body = await getBody(req)
      const { id, name, slug } = body
      if (!id || !name || !slug) {
        sendJson(res, { error: 'Missing id, name, or slug' }, 400)
        return true
      }
      const ws = await productService.createWorkspace(id, name, slug)
      sendJson(res, ws)
      return true
    }

    // 3. GET /api/projects
    if (pathname === '/api/projects' && method === 'GET') {
      const workspaceId = getQueryParam(url, 'workspaceId')
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const projects = await productService.getProjects(workspaceId)
      sendJson(res, projects)
      return true
    }

    // 4. POST /api/projects
    if (pathname === '/api/projects' && method === 'POST') {
      const body = await getBody(req)
      const { workspaceId, id, name } = body
      if (!workspaceId || !id || !name) {
        sendJson(res, { error: 'Missing workspaceId, id, or name' }, 400)
        return true
      }
      const project = await productService.createProject(workspaceId, id, name)
      sendJson(res, project)
      return true
    }

    // 5. GET /api/projects/:id/repository
    const repoMatch = pathname.match(/^\/api\/projects\/([^/]+)\/repository$/)
    if (repoMatch && method === 'GET') {
      const projectId = repoMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const conn = await productService.getRepositoryConnection(workspaceId, projectId)
      sendJson(res, conn || { status: 'not_connected' })
      return true
    }

    // 6. POST /api/projects/:id/repository
    if (repoMatch && method === 'POST') {
      const projectId = repoMatch[1]
      const body = await getBody(req)
      const { workspaceId, provider, owner, repository, defaultBranch } = body
      if (!workspaceId || !provider || !owner || !repository || !defaultBranch) {
        sendJson(res, { error: 'Missing fields' }, 400)
        return true
      }
      const conn = await productService.connectRepository(workspaceId, projectId, {
        provider,
        owner,
        repository,
        defaultBranch,
      })
      sendJson(res, conn)
      return true
    }

    // 7. POST /api/projects/:id/analysis
    const analysisMatch = pathname.match(/^\/api\/projects\/([^/]+)\/analysis$/)
    if (analysisMatch && method === 'POST') {
      const projectId = analysisMatch[1]
      const body = await getBody(req)
      const { workspaceId } = body
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const run = await productService.runAnalysis(workspaceId, projectId)
      sendJson(res, run)
      return true
    }

    // 8. GET /api/projects/:id/findings
    const findingsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/findings$/)
    if (findingsMatch && method === 'GET') {
      const projectId = findingsMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const findings = await productService.getFindings(workspaceId, projectId)
      sendJson(res, findings)
      return true
    }

    // 9. GET /api/projects/:id/recommendations
    const recsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/recommendations$/)
    if (recsMatch && method === 'GET') {
      const projectId = recsMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const recs = await productService.getRecommendations(workspaceId, projectId)
      sendJson(res, recs)
      return true
    }

    // 10. POST /api/actions/:id/approve
    const approveMatch = pathname.match(/^\/api\/actions\/([^/]+)\/approve$/)
    if (approveMatch && method === 'POST') {
      const body = await getBody(req)
      const { workspaceId, projectId, recommendationId, proposedActionId } = body
      if (!workspaceId || !projectId || !recommendationId || !proposedActionId) {
        sendJson(res, { error: 'Missing fields' }, 400)
        return true
      }
      const action = await productService.approveAction(workspaceId, projectId, recommendationId, proposedActionId)
      sendJson(res, action)
      return true
    }

    // 11. GET /api/actions/:id/executions
    const execsMatch = pathname.match(/^\/api\/actions\/([^/]+)\/executions$/)
    if (execsMatch && method === 'GET') {
      const actionId = execsMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const execs = await productService.getExecutions(workspaceId, actionId)
      sendJson(res, execs)
      return true
    }

    // 12. GET /api/actions/:id
    const actionMatch = pathname.match(/^\/api\/actions\/([^/]+)$/)
    if (actionMatch && method === 'GET') {
      const actionId = actionMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const action = await productService.getAction(workspaceId, actionId)
      sendJson(res, action || { error: 'Action not found' }, action ? 200 : 404)
      return true
    }

    // 13. GET /api/projects/:id/activity
    const activityMatch = pathname.match(/^\/api\/projects\/([^/]+)\/activity$/)
    if (activityMatch && method === 'GET') {
      const projectId = activityMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const activityLog = await productService.getActivityLog(workspaceId, projectId)
      sendJson(res, activityLog)
      return true
    }

    // 14. GET /api/recommendations/:id/reasoning
    const reasoningMatch = pathname.match(/^\/api\/recommendations\/([^/]+)\/reasoning$/)
    if (reasoningMatch && method === 'GET') {
      const recId = reasoningMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }

      const rec = await productRepository.getRecommendationByIdAndWorkspace(recId, createWorkspaceId(workspaceId))
      if (!rec) {
        sendJson(res, { error: 'Recommendation not found' }, 404)
        return true
      }

      const mockProvider = new MockLLMProvider(JSON.stringify({
        rationale: "Enabling this reduces codebase technical debt and secures release velocity.",
        impactExplanation: "Uncaught failures leak directly to our client interfaces causing user churn.",
        tradeoffs: [
          "Improves reliability gates",
          "Slightly increases setup and build compilation overhead"
        ],
        alternatives: [
          {
            label: "Option A — Enable globally",
            effort: "high",
            impact: "critical",
            description: "Enforce strict configuration rules globally across all modules."
          },
          {
            label: "Option B — Enable incrementally",
            effort: "low",
            impact: "high",
            description: "Configure rules incrementally for new subfolders only."
          }
        ],
        knowns: [
          "tsconfig.json parameters are disabled",
          "CI workflow lacks validation"
        ],
        inferences: [
          "Post-release support burden is likely elevated"
        ],
        unknowns: [
          "Telemetry and client-side error crash rate metrics are currently unmeasured"
        ],
        clarifyingQuestions: [
          "How frequently do you release code to production?",
          "Do you have a dedicated manual QA verification team step?"
        ],
        confidence: 0.95,
        recommendedDecision: "Adopt Option B (Incremental setup) to maximize immediate ROI."
      }))

      const reasoningService = new ProductReasoningService(productRepository, mockProvider)
      let reasoning = await productRepository.getAIProductReasoning(recId, createWorkspaceId(workspaceId))
      
      if (!reasoning) {
        reasoning = await reasoningService.generateReasoning(rec as any)
      }
      sendJson(res, reasoning)
      return true
    }

    // 15. POST /api/recommendations/:id/reasoning (Refinement loop!)
    if (reasoningMatch && method === 'POST') {
      const recId = reasoningMatch[1]
      const body = await getBody(req)
      const { workspaceId, projectContext } = body
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }

      const rec = (await productRepository.getRecommendationByIdAndWorkspace(recId, createWorkspaceId(workspaceId))) as any
      if (!rec) {
        sendJson(res, { error: 'Recommendation not found' }, 404)
        return true
      }

      // Dynamic recalculation: update priority score based on feedback! (Item 6)
      if (projectContext && (projectContext.toLowerCase().includes('daily') || projectContext.toLowerCase().includes('hourly'))) {
        rec.priorityScore = Math.round(rec.priorityScore * 1.5 * 10) / 10
        await productRepository.saveRecommendation(rec, (rec as any).projectId)
      }

      const mockProvider = new MockLLMProvider(JSON.stringify({
        rationale: "Enabling this reduces codebase technical debt and secures release velocity.",
        impactExplanation: `Refined by user context: ${projectContext}. Addressing this secures active production deployment safety.`,
        tradeoffs: [
          "Improves reliability gates",
          "Slightly increases build time"
        ],
        alternatives: [
          {
            label: "Option A — Enable globally",
            effort: "high",
            impact: "critical",
            description: "Enforce strict configuration rules globally."
          }
        ],
        knowns: [
          "TS parameters are disabled"
        ],
        inferences: [
          "Post-release support burden is likely elevated"
        ],
        unknowns: [
          "Telemetry is currently unmeasured"
        ],
        clarifyingQuestions: [],
        confidence: 0.98,
        recommendedDecision: "Adopt immediately as requested by context."
      }))

      const reasoningService = new ProductReasoningService(productRepository, mockProvider)
      const reasoning = await reasoningService.generateReasoning(rec as any, projectContext)
      sendJson(res, reasoning)
      return true
    }

    // 16. GET /api/projects/:id/decision-metrics
    const metricsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/decision-metrics$/)
    if (metricsMatch && method === 'GET') {
      const projectId = metricsMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const metrics = await productService.getDecisionQualityMetrics(workspaceId, projectId)
      sendJson(res, metrics)
      return true
    }

    // 17. GET /api/projects/:id/outcomes
    const outcomesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/outcomes$/)
    if (outcomesMatch && method === 'GET') {
      const projectId = outcomesMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const outcomes = await productService.getOutcomesByProject(workspaceId, projectId)
      sendJson(res, outcomes)
      return true
    }

    // 18. POST /api/outcomes/verify
    if (pathname === '/api/outcomes/verify' && method === 'POST') {
      const body = await getBody(req)
      const { workspaceId, outcomeId, filesAfterChange } = body
      if (!workspaceId || !outcomeId || !filesAfterChange) {
        sendJson(res, { error: 'Missing workspaceId, outcomeId, or filesAfterChange' }, 400)
        return true
      }
      const verified = await productService.verifyOutcome(outcomeId, workspaceId, filesAfterChange)
      sendJson(res, verified)
      return true
    }

    // 19. POST /api/outcomes/create
    if (pathname === '/api/outcomes/create' && method === 'POST') {
      const body = await getBody(req)
      const { workspaceId, projectId, recommendationId, actionId, executionId } = body
      if (!workspaceId || !projectId || !recommendationId) {
        sendJson(res, { error: 'Missing fields' }, 400)
        return true
      }
      const outcome = await productService.createOutcome(recommendationId, workspaceId, projectId, actionId, executionId)
      sendJson(res, outcome)
      return true
    }

    // 20. POST /api/projects/:id/compile-profile
    const compileProfileMatch = pathname.match(/^\/api\/projects\/([^/]+)\/compile-profile$/)
    if (compileProfileMatch && method === 'POST') {
      const projectId = compileProfileMatch[1]
      const body = await getBody(req)
      const { workspaceId } = body
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const profile = await productService.compileAdaptiveProfile(workspaceId, projectId)
      sendJson(res, profile)
      return true
    }

    // 21. GET /api/projects/:id/profile
    const profileMatch = pathname.match(/^\/api\/projects\/([^/]+)\/profile$/)
    if (profileMatch && method === 'GET') {
      const projectId = profileMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const profile = await productService.getAdaptiveProfile(workspaceId, projectId)
      sendJson(res, profile || { error: 'Profile not found' }, profile ? 200 : 404)
      return true
    }

    // 22. GET /api/projects/:id/learning-signals
    const signalsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/learning-signals$/)
    if (signalsMatch && method === 'GET') {
      const projectId = signalsMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      if (!workspaceId) {
        sendJson(res, { error: 'Missing workspaceId' }, 400)
        return true
      }
      const signals = await productService.getLearningSignals(workspaceId, projectId)
      sendJson(res, signals)
      return true
    }

    // 23. GET /api/recommendations/:id/calibration
    const calibrationMatch = pathname.match(/^\/api\/recommendations\/([^/]+)\/calibration$/)
    if (calibrationMatch && method === 'GET') {
      const recId = calibrationMatch[1]
      const workspaceId = getQueryParam(url, 'workspaceId')
      const projectId = getQueryParam(url, 'projectId')
      if (!workspaceId || !projectId) {
        sendJson(res, { error: 'Missing workspaceId or projectId' }, 400)
        return true
      }
      const calibration = await productService.getPriorityCalibration(workspaceId, projectId, recId)
      sendJson(res, calibration)
      return true
    }

  } catch (err) {
    console.error('[API Error]', err)
    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500)
    return true
  }

  return false // let other middlewares process
}
