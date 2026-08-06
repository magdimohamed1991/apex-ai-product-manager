import { useState } from 'react'
import { OnboardingPage } from './features/onboarding/page'
import { DashboardPage } from './features/dashboard/page'

type AppView = 'onboarding' | 'dashboard'

export default function App() {
  const [view, setView] = useState<AppView>('onboarding')

  if (view === 'dashboard') {
    return <DashboardPage />
  }

  return <OnboardingPage onComplete={() => setView('dashboard')} />
}
