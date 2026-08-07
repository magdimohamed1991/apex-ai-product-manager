import type { Workspace } from '../entities'
import type { WorkspaceId, WorkspaceSlug } from '../value-objects'

/**
 * Contract for Workspace persistence.
 * Implementation can be Supabase, PostgreSQL, local JSON, or in-memory mock.
 */
export interface WorkspaceRepository {
  getById(id: WorkspaceId): Promise<Workspace | null>
  getBySlug(slug: WorkspaceSlug): Promise<Workspace | null>
  save(workspace: Workspace): Promise<void>
  delete(id: WorkspaceId): Promise<void>
}
