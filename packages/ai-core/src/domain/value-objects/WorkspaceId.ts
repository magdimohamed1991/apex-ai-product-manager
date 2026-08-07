export type WorkspaceId = string & { readonly _brand: 'WorkspaceId' }

export function createWorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}
