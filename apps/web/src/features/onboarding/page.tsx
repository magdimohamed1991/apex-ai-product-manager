import { useOnboarding } from './hooks/useOnboarding'
import { ProgressIndicator, NavigationButtons } from './shared'
import {
  WelcomeStep,
  ProductTypeStep,
  ProductInfoStep,
  IntegrationsStep,
  ReviewStep,
  LoadingStep,
} from './steps'
import { TOTAL_STEPS } from './constants'

interface OnboardingPageProps {
  onComplete: () => void
}

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const {
    state,
    nextStep,
    prevStep,
    setProductType,
    setProductInfo,
    setIntegrationValue,
    canProceed,
  } = useOnboarding()

  const isWelcome = state.step === 1
  const isLoading = state.step === TOTAL_STEPS

  const renderStep = () => {
    switch (state.step) {
      case 1:
        return <WelcomeStep onStart={nextStep} />
      case 2:
        return <ProductTypeStep selected={state.productType} onSelect={setProductType} />
      case 3:
        return (
          <ProductInfoStep
            productName={state.productName}
            companyName={state.companyName}
            website={state.website}
            onChange={setProductInfo}
          />
        )
      case 4:
        return <IntegrationsStep integrations={state.integrations} onChange={setIntegrationValue} />
      case 5:
        return <ReviewStep state={state} />
      case 6:
        return <LoadingStep onComplete={onComplete} />
      default:
        return null
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-xl">
        {!isWelcome && !isLoading && (
          <div className="mb-8 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">
              Step {state.step - 1} of {TOTAL_STEPS - 2}
            </span>
            <ProgressIndicator currentStep={state.step - 1} />
          </div>
        )}

        <div className="min-h-[400px]">{renderStep()}</div>

        {!isWelcome && !isLoading && (
          <div className="mt-8">
            <NavigationButtons
              step={state.step}
              totalSteps={TOTAL_STEPS}
              canProceed={canProceed()}
              onNext={nextStep}
              onPrev={prevStep}
            />
          </div>
        )}
      </div>
    </div>
  )
}
