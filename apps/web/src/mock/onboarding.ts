// Mock data for Onboarding demo — no real API calls

export const MOCK_DELAY_MS = 1200

export const MOCK_LOADING_DURATION_MS = 6000

export async function mockCreateWorkspace(): Promise<{ id: string }> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_LOADING_DURATION_MS))
  return { id: 'mock-workspace-001' }
}
