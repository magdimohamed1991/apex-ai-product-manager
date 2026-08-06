export type ProductType = 'mobile-app' | 'saas' | 'marketplace' | 'ai-product' | 'internal-tool'

export type IntegrationStatus = 'idle' | 'connected' | 'skipped'

export interface Integration {
  id: string
  name: string
  description: string
  placeholder: string
  value: string
  status: IntegrationStatus
}

export interface OnboardingState {
  step: number
  productType: ProductType | null
  productName: string
  companyName: string
  website: string
  integrations: Integration[]
}

export type OnboardingStep =
  'welcome' | 'product-type' | 'product-info' | 'integrations' | 'review' | 'loading'
