/**
 * Core AI interfaces for the APEX agent system.
 * All agents must implement these contracts.
 */

export interface AIProvider {
  name: string
  model: string
  call(prompt: string): Promise<string>
}

export interface AgentContext {
  productName: string
  productType: string
  integrations: Record<string, string>
  memory?: AgentMemory
}

export interface AgentMemory {
  id: string
  createdAt: Date
  facts: string[]
  summaries: string[]
}

export interface AgentResult {
  agentId: string
  status: 'success' | 'error' | 'partial'
  data: unknown
  reasoning?: string
  confidence?: number
  processedAt: Date
}

export interface Agent {
  id: string
  name: string
  description: string
  run(context: AgentContext): Promise<AgentResult>
}

export interface Workflow {
  id: string
  name: string
  agents: Agent[]
  run(context: AgentContext): Promise<AgentResult[]>
}

export interface KnowledgeItem {
  id: string
  source: string
  content: string
  metadata: Record<string, unknown>
  embedding?: number[]
  createdAt: Date
}
