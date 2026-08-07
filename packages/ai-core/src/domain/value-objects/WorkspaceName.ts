export type WorkspaceName = string & { readonly _brand: 'WorkspaceName' }

export function createWorkspaceName(name: string): WorkspaceName {
  if (!name || name.trim().length === 0) {
    throw new Error('WorkspaceName cannot be empty')
  }
  if (name.length > 100) {
    throw new Error('WorkspaceName cannot exceed 100 characters')
  }
  return name.trim() as WorkspaceName
}
