import { useState } from 'react'
import { OnboardingPage } from './app/onboarding/page'
import { DashboardPage } from './app/dashboard/page'

type AppView = 'onboarding' | 'dashboard'

export default function App() {
  const [view, setView] = useState<AppView>('onboarding')

  if (view === 'dashboard') {
    return <DashboardPage />
  }

  return <OnboardingPage onComplete={() => setView('dashboard')} />
}
