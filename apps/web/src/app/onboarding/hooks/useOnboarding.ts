import { useState, useCallback } from 'react'
import type { OnboardingState, ProductType } from '../types'
import { DEFAULT_INTEGRATIONS, TOTAL_STEPS } from '../constants'

const initialState: OnboardingState = {
  step: 1,
  productType: null,
  productName: '',
  companyName: '',
  website: '',
  integrations: DEFAULT_INTEGRATIONS,
}

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(initialState)

  const nextStep = useCallback(() => {
    setState((prev) => ({ ...prev, step: Math.min(prev.step + 1, TOTAL_STEPS) }))
  }, [])

  const prevStep = useCallback(() => {
    setState((prev) => ({ ...prev, step: Math.max(prev.step - 1, 1) }))
  }, [])

  const setProductType = useCallback((type: ProductType) => {
    setState((prev) => ({ ...prev, productType: type }))
  }, [])

  const setProductInfo = useCallback(
    (info: { productName: string; companyName: string; website: string }) => {
      setState((prev) => ({ ...prev, ...info }))
    },
    []
  )

  const setIntegrationValue = useCallback((id: string, value: string) => {
    setState((prev) => ({
      ...prev,
      integrations: prev.integrations.map((integration) =>
        integration.id === id
          ? { ...integration, value, status: value ? 'connected' : 'idle' }
          : integration
      ),
    }))
  }, [])

  const canProceed = useCallback(() => {
    switch (state.step) {
      case 1:
        return true
      case 2:
        return state.productType !== null
      case 3:
        return state.productName.trim().length > 0 && state.companyName.trim().length > 0
      case 4:
        return state.integrations.some((i) => i.status === 'connected')
      case 5:
        return true
      default:
        return false
    }
  }, [state])

  return {
    state,
    nextStep,
    prevStep,
    setProductType,
    setProductInfo,
    setIntegrationValue,
    canProceed,
  }
}
