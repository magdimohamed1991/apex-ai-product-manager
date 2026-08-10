/// <reference types="node" />

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import {
  createWorkspaceId,
  createWorkspaceName,
  createWorkspaceSlug,
} from '../../domain/value-objects'
import type {
  Workspace,
  Project,
  RepositoryConnection,
  PipelineRun,
  Finding,
  Recommendation,
  Action,
  Execution,
  RichRecommendation,
} from '../../domain/entities'
import type { ProductRepository } from '../../domain/repositories/ProductRepository'
import type { ActionRepository } from '../../domain/repositories/ActionRepository'
import { ActionApplicationService } from './ActionApplicationService'
import { PipelineActionOrchestrator } from './PipelineActionOrchestrator'
import type { CredentialProvider } from './CredentialProvider'
import { ProductIntelligenceService } from './ProductIntelligenceService'
import { RecommendationOutcomeService } from './RecommendationOutcomeService'
import type { DecisionQualityMetrics } from './RecommendationOutcomeService'
import type { AIProductReasoning, RecommendationOutcome } from '../../domain/entities'
import { AdaptiveProfileCompiler } from './AdaptiveProfileCompiler'
import { H6PrioritizationCalibrator } from './H6PrioritizationCalibrator'
import type { AdaptiveLearningProfileRepository } from '../../domain/repositories/AdaptiveLearningProfileRepository'
import type {
  AdaptiveLearningProfile,
  LearningSignal,
  PriorityCalibration,
} from '../../domain/entities/ProductAdaptive'
import { ProductValidationService } from './ProductValidationService'
import type { ProductValidationMetrics } from './ProductValidationService'
import { Logger } from '../../observability/Logger'
import { SecurityError, NotFoundError, AuthorizationError } from '../../errors/AppError'
import { transitionAction } from '../../domain/entities/Action'
import type { VerificationEvidence } from '../../domain/entities/ProductAdaptive'
import type { PMDecisionTelemetry, PMDecisionKind } from '../../domain/entities'
import type { PMDecisionTelemetryService } from './PMDecisionTelemetryService'
import { ValidationError } from '../../errors/AppError'

const log = new Logger('product.service')

export interface ConnectionInput {
  provider: 'github'
  owner: string
  repository: string
  defaultBranch: string
}

export class APEXProductService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly actionRepository: ActionRepository,
    private readonly actionAppService: ActionApplicationService,
    private readonly orchestrator: PipelineActionOrchestrator,
    private readonly credentialProvider: CredentialProvider,
    private readonly intelligenceService: ProductIntelligenceService,
    private readonly outcomeService: RecommendationOutcomeService,
    private readonly profileCompiler?: AdaptiveProfileCompiler,
    private readonly profileRepository?: AdaptiveLearningProfileRepository,
    private readonly calibrator?: H6PrioritizationCalibrator,
    private readonly validationService?: ProductValidationService,
    private readonly telemetryService?: PMDecisionTelemetryService
  ) {}

  /**
   * True when the connected repository is the APEX monorepo itself, in which
   * case local analysis of the running checkout is a real scan (not a mock).
   */
  private isOurMonorepo(repository: string): boolean {
    return (
      repository.toLowerCase() === 'apex-ai-product-manager' || repository.toLowerCase() === 'apex'
    )
  }

  async createWorkspace(id: string, name: string, slug: string): Promise<Workspace> {
    const ws: Workspace = {
      id: createWorkspaceId(id),
      name: createWorkspaceName(name),
      slug: createWorkspaceSlug(slug),
      type: 'saas',
      status: 'active',
      integrations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await this.productRepository.saveWorkspace(ws)
    return ws
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    return this.productRepository.getWorkspaceById(createWorkspaceId(id))
  }

  async getAllWorkspaces(): Promise<Workspace[]> {
    return this.productRepository.getAllWorkspaces()
  }

  async createProject(workspaceId: string, id: string, name: string): Promise<Project> {
    const proj: Project = {
      id,
      workspaceId: createWorkspaceId(workspaceId),
      name,
      createdAt: new Date(),
    }
    await this.productRepository.saveProject(proj)
    return proj
  }

  async getProjects(workspaceId: string): Promise<Project[]> {
    return this.productRepository.getProjectsByWorkspace(createWorkspaceId(workspaceId))
  }

  async connectRepository(
    workspaceId: string,
    projectId: string,
    input: ConnectionInput
  ): Promise<RepositoryConnection> {
    const wsId = createWorkspaceId(workspaceId)
    const conn: RepositoryConnection = {
      id: `conn-${crypto.randomUUID()}`,
      workspaceId: wsId,
      projectId,
      provider: input.provider,
      owner: input.owner,
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      status: 'connected',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await this.productRepository.saveRepositoryConnection(conn)
    return conn
  }

  async getRepositoryConnection(
    workspaceId: string,
    projectId: string
  ): Promise<RepositoryConnection | null> {
    return this.productRepository.getRepositoryConnectionByProject(
      projectId,
      createWorkspaceId(workspaceId)
    )
  }

  async runAnalysis(workspaceId: string, projectId: string): Promise<PipelineRun> {
    const wsId = createWorkspaceId(workspaceId)
    const conn = await this.productRepository.getRepositoryConnectionByProject(projectId, wsId)
    if (!conn) {
      throw new Error(
        `No repository connection found for project "${projectId}" inside workspace "${workspaceId}"`
      )
    }

    // 1. Fetch credentials securely at the application boundary (Item 5)
    const creds = await this.credentialProvider.getCredentials(wsId, 'github')

    const runId = `run-${crypto.randomUUID()}`
    const pipelineRun: PipelineRun = {
      id: runId,
      workspaceId: wsId,
      projectId,
      repositoryConnectionId: conn.id,
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      error: null,
    }
    await this.productRepository.savePipelineRun(pipelineRun)

    // Setup safe clone temporary directory path (Item 3)
    const tempDir = path.join(os.tmpdir(), 'apex-clones', `clone-${conn.id}`)
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }

    const isProduction = process.env.NODE_ENV === 'production'

    try {
      // Execute fast depth-1 clone of arbitrary repository (Item 3).
      // Token classification mirrors GitHubAdapter.isLikelyProductionToken:
      // only a token with a real GitHub PAT prefix (ghp_/github_pat_/gho_/
      // ghu_/ghs_/ghr_) triggers a real clone. Everything else (dev mock
      // tokens, 'valid-token', arbitrary strings) is treated as non-real.
      // A substring check (e.g. `token.includes('test')`) must NEVER be
      // used — a real PAT could contain such a substring and would
      // silently skip the real clone.
      const isMockToken = !/^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)/.test(creds.token)
      let clonedSuccessfully = false

      if (!isMockToken) {
        fs.mkdirSync(tempDir, { recursive: true })
        try {
          const authUrl = `https://x-token-auth:${creds.token}@github.com/${conn.owner}/${conn.repository}.git`
          execSync(`git clone --depth 1 ${authUrl} ${tempDir}`, { stdio: 'ignore' })
          clonedSuccessfully = true
          log.info('Successfully cloned real repository', {
            owner: conn.owner,
            repository: conn.repository,
            tempDir,
          })
        } catch (err) {
          // The thrown error from execSync contains the full command line,
          // including the embedded token in the auth URL. Redact it before
          // logging; never leak credentials into logs.
          log.warn('Real clone failed; falling back to local analysis', {
            owner: conn.owner,
            repository: conn.repository,
            // Redact anything that looks like a token in the raw message.
            err: String(err instanceof Error ? err.message : err).replace(
              /x-token-auth:[^@\s]+@/g,
              'x-token-auth:[REDACTED]@'
            ),
          })
        }
      }

      // Production safety (Rule 4 — no silent mock downgrade): if the real
      // clone failed (or was skipped) while running in production, the
      // analysis MUST fail explicitly instead of fabricating findings from
      // a local/mock scan of an arbitrary repository.
      if (isProduction && !clonedSuccessfully && !this.isOurMonorepo(conn.repository)) {
        throw new SecurityError(
          `Repository clone failed for ${conn.owner}/${conn.repository}. Refusing to run a mock analysis in production; the pipeline run is marked failed.`
        )
      }

      // Build scanner files object
      const filesObj = {
        url: `https://github.com/${conn.owner}/${conn.repository}`,
        packageJson: { name: conn.repository, dependencies: {} } as Record<string, unknown>,
        hasDockerfile: false,
        hasPnpmWorkspace: false,
        hasTurboJson: false,
        hasGitHubActions: false,
        hasJestConfig: false,
        hasVitestConfig: false,
        hasTailwindConfig: false,
        hasTypeScriptConfig: false,
        fileList: ['package.json'],
      }

      const scanSourceDir = clonedSuccessfully ? tempDir : process.cwd()

      if (clonedSuccessfully || this.isOurMonorepo(conn.repository)) {
        const packageJsonPath = path.join(scanSourceDir, 'package.json')
        if (fs.existsSync(packageJsonPath)) {
          try {
            filesObj.packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
          } catch {
            // fallback
          }
        }
        filesObj.hasDockerfile = fs.existsSync(path.join(scanSourceDir, 'Dockerfile'))
        filesObj.hasPnpmWorkspace = fs.existsSync(path.join(scanSourceDir, 'pnpm-workspace.yaml'))
        filesObj.hasTurboJson = fs.existsSync(path.join(scanSourceDir, 'turbo.json'))
        filesObj.hasGitHubActions = fs.existsSync(path.join(scanSourceDir, '.github/workflows'))
        filesObj.hasJestConfig =
          fs.existsSync(path.join(scanSourceDir, 'jest.config.js')) ||
          fs.existsSync(path.join(scanSourceDir, 'jest.config.ts'))
        filesObj.hasVitestConfig =
          fs.existsSync(path.join(scanSourceDir, 'vitest.config.ts')) ||
          fs.existsSync(path.join(scanSourceDir, 'vite.config.ts'))
        filesObj.hasTailwindConfig = fs.existsSync(path.join(scanSourceDir, 'tailwind.config.js'))
        filesObj.hasTypeScriptConfig = fs.existsSync(path.join(scanSourceDir, 'tsconfig.json'))

        try {
          filesObj.fileList = fs.readdirSync(scanSourceDir).slice(0, 15)
        } catch {
          // fallback
        }
      } else {
        // Fallback simulation parameters to trigger analysis rules (Item 4)
        filesObj.hasDockerfile = false
        filesObj.hasPnpmWorkspace = false
        filesObj.hasTurboJson = false
        filesObj.hasGitHubActions = false
        filesObj.hasJestConfig = false
        filesObj.hasVitestConfig = false
        filesObj.hasTailwindConfig = false
        filesObj.hasTypeScriptConfig = false
      }

      // 2. Clear old findings and recommendations for the project to ensure clean, repeatable runs
      await this.productRepository.deleteFindingsByProject(projectId, wsId)
      await this.productRepository.deleteRecommendationsByProject(projectId, wsId)

      // 3. Execute the pipeline analysis ONCE and promote proposed actions in
      //    proposed state (Item 3 & Item 7). The same run's findings and
      //    recommendations are persisted below — the pipeline is NOT executed
      //    a second time (previously the orchestrator ran it once for
      //    promotion and APEXProductService re-ran it via a private-field
      //    access to persist results, producing two independent run IDs and
      //    risking divergence between promoted actions and saved rows).
      const orchestrated = await this.orchestrator.runPipelineAndPromote(
        wsId,
        filesObj,
        undefined,
        projectId
      )
      const runResult = orchestrated.pipelineResult

      for (const f of runResult.findings) {
        await this.productRepository.saveFinding(f, projectId)
      }

      // Assess and rank raw recommendations using the Product Intelligence engine! (Item 1 & Item 2)
      const richRecs = this.intelligenceService.assessAndRank(runResult.recommendations)

      for (const r of richRecs) {
        await this.productRepository.saveRecommendation(r, projectId)
      }

      // 5. Update pipeline run status
      pipelineRun.status = 'completed'
      pipelineRun.completedAt = new Date()
      await this.productRepository.savePipelineRun(pipelineRun)
    } catch (err) {
      pipelineRun.status = 'failed'
      pipelineRun.completedAt = new Date()
      pipelineRun.error = err instanceof Error ? err.message : String(err)
      await this.productRepository.savePipelineRun(pipelineRun)
      throw err
    } finally {
      // Securely delete temporary clone folder (Item 3)
      if (fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }
    }

    return pipelineRun
  }

  async getPipelineRuns(workspaceId: string, projectId: string): Promise<PipelineRun[]> {
    return this.productRepository.getPipelineRunsByProject(
      projectId,
      createWorkspaceId(workspaceId)
    )
  }

  async getFindings(workspaceId: string, projectId: string): Promise<Finding[]> {
    return this.productRepository.getFindingsByProject(projectId, createWorkspaceId(workspaceId))
  }

  async getRecommendations(workspaceId: string, projectId: string): Promise<Recommendation[]> {
    return this.productRepository.getRecommendationsByProject(
      projectId,
      createWorkspaceId(workspaceId)
    )
  }

  /**
   * Promotes and Approves a Proposed Action (Item 10)
   *
   * Idempotency: if the action for this (recommendation, proposedAction)
   * already exists and is no longer `proposed`, the existing action is
   * returned unchanged and NO duplicate transition record is appended.
   * Repeating the same approval (e.g. double-click) is therefore a no-op
   * that cannot corrupt the audit trail.
   */
  async approveAction(
    workspaceId: string,
    projectId: string,
    recommendationId: string,
    proposedActionId: string
  ): Promise<Action> {
    const wsId = createWorkspaceId(workspaceId)

    // 1. Verify the recommendation exists AND belongs to the requested
    //    project (strict project scoping — a workspace member cannot
    //    approve another project's recommendation through this call).
    const recs = await this.productRepository.getRecommendationsByProject(projectId, wsId)
    const rec = recs.find((r) => r.id === recommendationId) || null
    if (!rec) {
      throw new NotFoundError(
        `Recommendation "${recommendationId}" not found in project "${projectId}" inside workspace "${workspaceId}"`
      )
    }

    const pa = rec.proposedActions.find((p) => p.id === proposedActionId)
    if (!pa) {
      throw new NotFoundError(
        `ProposedAction "${proposedActionId}" does not exist on Recommendation "${recommendationId}"`
      )
    }

    // 2. Promote using the ActionApplicationService with stable, idempotent keys (Item 1)
    const action = await this.actionAppService.promoteProposedAction(rec, pa)

    // Idempotent re-approval guard: the promotion already happened (or the
    // action already exists in a non-proposed state). Never append a second
    // approval transition or mutate an in-flight action.
    if (action.status !== 'proposed') {
      return action
    }

    // 3. Set Action target to 'github' so that it performs the required external side effects on execution (Item 12)
    action.target = 'github'

    // 4. Transition status from 'proposed' to 'approved' using the domain
    //    state machine (validates actor authority) instead of a raw field
    //    mutation (Item 10)
    const approvedAction = transitionAction(action, 'approved', 'user')
    await this.actionRepository.save(approvedAction)

    // Log user approval as an action transition event
    const transitions = await this.actionRepository.getTransitionsByAction(approvedAction.id, wsId)
    const nextSeq = transitions.length + 1
    const trans = {
      id: crypto.randomUUID(),
      actionId: approvedAction.id,
      workspaceId: wsId,
      fromStatus: 'proposed' as const,
      toStatus: 'approved' as const,
      sequence: nextSeq,
      actor: 'user' as const,
      reason: 'User approved recommendation.',
      timestamp: new Date(),
    }
    await this.actionRepository.saveTransition(trans)

    return approvedAction
  }

  async getAction(
    workspaceId: string,
    projectId: string,
    actionId: string
  ): Promise<Action | null> {
    const wsId = createWorkspaceId(workspaceId)
    const action = await this.actionRepository.getByIdAndWorkspace(actionId, wsId)
    if (!action) return null
    // Actions inherit ownership from their related recommendation. The frozen
    // Action repository is workspace-scoped, so enforce project scope here.
    return (await this.productRepository.getRecommendationByIdWorkspaceAndProject(
      action.relatedRecommendationId,
      wsId,
      projectId
    ))
      ? action
      : null
  }

  async getExecutions(
    workspaceId: string,
    projectId: string,
    actionId: string
  ): Promise<Execution[]> {
    const action = await this.getAction(workspaceId, projectId, actionId)
    return action
      ? this.actionRepository.getExecutionsByAction(actionId, createWorkspaceId(workspaceId))
      : []
  }

  /**
   * Chronological Audit / Activity Timeline (Item 14)
   */
  async getActivityLog(
    workspaceId: string,
    projectId: string
  ): Promise<
    Array<{
      timestamp: Date
      type: string
      title: string
      description: string
      metadata?: Record<string, unknown>
    }>
  > {
    const wsId = createWorkspaceId(workspaceId)
    const timeline: Array<{
      timestamp: Date
      type: string
      title: string
      description: string
      metadata?: Record<string, unknown>
    }> = []

    // Get pipeline runs
    const runs = await this.productRepository.getPipelineRunsByProject(projectId, wsId)
    for (const r of runs) {
      timeline.push({
        timestamp: r.startedAt,
        type: 'pipeline',
        title: `Analysis Run ${r.status}`,
        description: r.error ? `Failed: ${r.error}` : `Discovery analysis run triggered.`,
        metadata: { runId: r.id },
      })
    }

    // Get findings — timestamps come from the persisted `createdAt` (the
    // real creation time), never from `new Date()` at read time.
    const findings = await this.productRepository.getFindingsByProject(projectId, wsId)
    for (const f of findings) {
      timeline.push({
        timestamp: new Date(f.createdAt),
        type: 'finding',
        title: `Finding Generated`,
        description: `${f.title} (${f.severity})`,
        metadata: { findingId: f.id },
      })
    }

    // Get recommendations — same real-timestamp rule.
    const recommendations = await this.productRepository.getRecommendationsByProject(
      projectId,
      wsId
    )
    for (const r of recommendations) {
      timeline.push({
        timestamp: new Date(r.createdAt),
        type: 'recommendation',
        title: `Recommendation Created`,
        description: r.title,
        metadata: { recommendationId: r.id },
      })
    }

    // Get all actions, scoped to THIS project. Actions are linked to a
    // project only through their relatedRecommendationId; the repository
    // exposes only workspace-wide queries, so we filter against the
    // project's recommendation ids. Without this filter, every action
    // transition/execution in the workspace (including other projects')
    // would appear in this project's timeline (cross-project leakage).
    const projectRecIds = new Set(recommendations.map((r) => r.id))
    const actions = (await this.actionRepository.getByWorkspace({ workspaceId: wsId })).filter(
      (a) => projectRecIds.has(a.relatedRecommendationId)
    )
    for (const a of actions) {
      const transitions = await this.actionRepository.getTransitionsByAction(a.id, wsId)
      for (const t of transitions) {
        timeline.push({
          timestamp: t.timestamp,
          type: 'action',
          title: `Action Status: ${t.toStatus}`,
          description: `Action "${a.title}" transitioned to ${t.toStatus} by ${t.actor}: ${t.reason}`,
          metadata: { actionId: a.id, transitionId: t.id },
        })
      }

      const executions = await this.actionRepository.getExecutionsByAction(a.id, wsId)
      for (const e of executions) {
        timeline.push({
          timestamp: e.startedAt,
          type: 'execution',
          title: `Execution Attempt #${e.attempt} ${e.status}`,
          description:
            e.status === 'completed'
              ? `Successfully executed. External ID: ${e.externalId}`
              : `Execution attempt failed: ${e.error?.message || 'unknown'}`,
          metadata: { actionId: a.id, executionId: e.id, externalId: e.externalId },
        })
      }
    }

    // Sort chronologically (latest first)
    return timeline.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }

  async getAIProductReasoning(
    recId: string,
    workspaceId: string
  ): Promise<AIProductReasoning | null> {
    return this.productRepository.getAIProductReasoning(recId, createWorkspaceId(workspaceId))
  }

  async saveAIProductReasoning(reasoning: AIProductReasoning): Promise<void> {
    await this.productRepository.saveAIProductReasoning(reasoning)
  }

  async getDecisionQualityMetrics(
    workspaceId: string,
    projectId: string
  ): Promise<DecisionQualityMetrics> {
    return this.outcomeService.getDecisionQualityMetrics(createWorkspaceId(workspaceId), projectId)
  }

  async verifyOutcome(
    outcomeId: string,
    workspaceId: string,
    projectId: string,
    filesAfterChange: VerificationEvidence
  ): Promise<RecommendationOutcome> {
    return this.outcomeService.verifyOutcome(
      outcomeId,
      createWorkspaceId(workspaceId),
      projectId,
      filesAfterChange
    )
  }

  async createOutcome(
    recId: string,
    workspaceId: string,
    projectId: string,
    actionId?: string,
    executionId?: string
  ): Promise<RecommendationOutcome> {
    return this.outcomeService.createOutcome(
      recId,
      createWorkspaceId(workspaceId),
      projectId,
      actionId,
      executionId
    )
  }

  async getOutcomesByProject(
    workspaceId: string,
    projectId: string
  ): Promise<RecommendationOutcome[]> {
    return this.outcomeService.getByProject(projectId, createWorkspaceId(workspaceId))
  }

  async compileAdaptiveProfile(
    workspaceId: string,
    projectId: string
  ): Promise<AdaptiveLearningProfile> {
    if (!this.profileCompiler) {
      throw new Error('Adaptive profile compiler is not registered')
    }
    return this.profileCompiler.compileProfile(createWorkspaceId(workspaceId), projectId)
  }

  async getAdaptiveProfile(
    workspaceId: string,
    projectId: string
  ): Promise<AdaptiveLearningProfile | null> {
    if (!this.profileRepository) {
      throw new Error('Adaptive profile repository is not registered')
    }
    return this.profileRepository.getProfile(createWorkspaceId(workspaceId), projectId)
  }

  async getLearningSignals(workspaceId: string, projectId: string): Promise<LearningSignal[]> {
    if (!this.profileRepository) {
      throw new Error('Adaptive profile repository is not registered')
    }
    return this.profileRepository.getSignals(createWorkspaceId(workspaceId), projectId)
  }

  async getPriorityCalibration(
    workspaceId: string,
    projectId: string,
    recommendationId: string
  ): Promise<PriorityCalibration> {
    if (!this.calibrator || !this.profileRepository) {
      throw new Error('Calibrator or profile repository is not registered')
    }
    const wsId = createWorkspaceId(workspaceId)
    const rec = await this.productRepository.getRecommendationByIdAndWorkspace(
      recommendationId,
      wsId
    )
    if (!rec) {
      throw new Error(`Recommendation "${recommendationId}" not found`)
    }
    // Project-scoping invariant: the persisted recommendation row carries its
    // owning project id; calibrating a recommendation of project A against
    // project B's profile/signals would silently mix scopes. (Same class as
    // the createOutcome project check.)
    const recProjectId = (rec as Recommendation & { projectId?: string }).projectId
    if (!recProjectId || recProjectId !== projectId) {
      throw new Error(
        `Recommendation "${recommendationId}" belongs to project "${recProjectId ?? '(unknown)'}", not the claimed project "${projectId}". Calibration rejected.`
      )
    }
    const profile = await this.profileRepository.getProfile(wsId, projectId)
    const signals = await this.profileRepository.getSignals(wsId, projectId)
    // Persisted recommendations ARE rich recommendations (runAnalysis stores
    // the assessAndRank output), so the cast is structural, not fabricated.
    return this.calibrator.calibrate(rec as Recommendation & RichRecommendation, profile, signals)
  }

  async getProductValidationMetrics(
    workspaceId: string,
    projectId: string
  ): Promise<ProductValidationMetrics> {
    if (!this.validationService) {
      throw new Error('Product validation service is not registered')
    }
    return this.validationService.evaluatePMValue(createWorkspaceId(workspaceId), projectId)
  }

  /**
   * Records a REAL PM decision into the H7 telemetry stream.
   *
   * The H3 baseline and H6 calibrated score are computed SERVER-SIDE from
   * the persisted recommendation and adaptive profile — the client only
   * supplies the decision kind, the real decision-window timestamps, and
   * any explicit PM override/rank. This prevents the client from
   * fabricating scores.
   */
  async recordPMDecision(input: {
    workspaceId: string
    projectId: string
    recommendationId: string
    decision: PMDecisionKind
    decisionStartedAt: Date
    decisionCompletedAt: Date
    recommendationPresentedAt: Date
    pmSelectedPriority?: number
    apexRank?: number
    pmRank?: number
  }): Promise<PMDecisionTelemetry> {
    if (!this.telemetryService) {
      throw new Error('H7 telemetry service is not registered')
    }
    const wsId = createWorkspaceId(input.workspaceId)

    // Telemetry ownership verification at the service boundary (H7
    // measurement integrity): raw telemetry must be structurally valid
    // BEFORE it is persisted — it must never rely on downstream aggregation
    // filters to hide a cross-tenant/cross-project relationship.
    //
    // 1. The claimed project must actually belong to the authenticated
    //    workspace. A cross-workspace project (or a project that does not
    //    exist in this workspace at all) is rejected with a 403-style
    //    AuthorizationError — we do NOT leak whether the id exists in
    //    another tenant.
    const project = await this.productRepository.getProjectByIdAndWorkspace(input.projectId, wsId)
    if (!project) {
      throw new AuthorizationError(
        `Project "${input.projectId}" is not accessible in workspace "${input.workspaceId}"; telemetry rejected.`
      )
    }

    // 2. The recommendation must belong to BOTH the claimed project AND the
    //    authenticated workspace (project.workspaceId === auth workspace, and
    //    recommendation.projectId === claimed projectId). A recommendation
    //    from another project in the same workspace, or from another
    //    workspace, fails this lookup and is rejected as a safe
    //    authorization failure (NotFoundError → 404/validation error).
    const recs = await this.productRepository.getRecommendationsByProject(input.projectId, wsId)
    const rec = recs.find((r) => r.id === input.recommendationId)
    if (!rec) {
      throw new NotFoundError(
        `Recommendation "${input.recommendationId}" not found in project "${input.projectId}" inside workspace "${input.workspaceId}"`
      )
    }

    // Never record telemetry against a fabricated score: if the persisted
    // row lacks its deterministic H3 decoration, refuse instead of guessing.
    const rich = rec as Recommendation & RichRecommendation
    if (typeof rich.priorityScore !== 'number') {
      throw new ValidationError(
        'Recommendation lacks its deterministic H3 score; re-run the analysis before recording decision telemetry'
      )
    }

    const profile = this.profileRepository
      ? await this.profileRepository.getProfile(wsId, input.projectId)
      : null
    const signals = this.profileRepository
      ? await this.profileRepository.getSignals(wsId, input.projectId)
      : []
    const calibration = this.calibrator ? this.calibrator.calibrate(rich, profile, signals) : null

    try {
      return await this.telemetryService.recordDecision({
        workspaceId: wsId,
        projectId: input.projectId,
        recommendationId: input.recommendationId,
        category: rec.category,
        originalH3Score: rich.priorityScore,
        calibratedH6Score: calibration ? calibration.calibratedScore : rich.priorityScore,
        decision: input.decision,
        decisionStartedAt: input.decisionStartedAt,
        decisionCompletedAt: input.decisionCompletedAt,
        recommendationPresentedAt: input.recommendationPresentedAt,
        pmSelectedPriority: input.pmSelectedPriority,
        apexRank: input.apexRank,
        pmRank: input.pmRank,
      })
    } catch (err) {
      // Client-supplied timestamps failing domain validation is a client
      // error, not an internal failure.
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err
      throw new ValidationError(
        `Invalid decision telemetry: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}
