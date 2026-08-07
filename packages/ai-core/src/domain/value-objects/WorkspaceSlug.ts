export type WorkspaceSlug = string & { readonly _brand: 'WorkspaceSlug' }

export function createWorkspaceSlug(name: string): WorkspaceSlug {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  if (!slug) {
    throw new Error('WorkspaceSlug cannot be empty')
  }

  return slug as WorkspaceSlug
}
