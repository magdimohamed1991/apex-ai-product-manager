import type { WorkspaceId, WorkspaceName, WorkspaceSlug, WorkspaceType } from '../value-objects'
import type { WorkspaceStatus } from '../value-objects'
import type { Integration } from './Integration'

export interface Workspace {
  id: WorkspaceId
  name: WorkspaceName
  slug: WorkspaceSlug
  type: WorkspaceType
  status: WorkspaceStatus
  integrations: Integration[]
  createdAt: Date
  updatedAt: Date
}
