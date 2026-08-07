import type { Integration, ProductType } from './types'

export const TOTAL_STEPS = 6

export const PRODUCT_TYPES: { id: ProductType; label: string; emoji: string }[] = [
  { id: 'mobile-app', label: 'Mobile App', emoji: '📱' },
  { id: 'saas', label: 'SaaS', emoji: '☁️' },
  { id: 'marketplace', label: 'Marketplace', emoji: '🏪' },
  { id: 'ai-product', label: 'AI Product', emoji: '🤖' },
  { id: 'internal-tool', label: 'Internal Tool', emoji: '🔧' },
]

export const DEFAULT_INTEGRATIONS: Integration[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Connect your repository',
    placeholder: 'https://github.com/org/repo',
    value: '',
    status: 'idle',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Connect your workspace',
    placeholder: 'https://linear.app/team',
    value: '',
    status: 'idle',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Connect your workspace',
    placeholder: 'https://yourteam.slack.com',
    value: '',
    status: 'idle',
  },
  {
    id: 'amplitude',
    name: 'Amplitude',
    description: 'Analytics & funnels',
    placeholder: 'Your API key',
    value: '',
    status: 'idle',
  },
  {
    id: 'google_play',
    name: 'Google Play',
    description: 'Store reviews & ratings',
    placeholder: 'com.your.app',
    value: '',
    status: 'idle',
  },
  {
    id: 'app_store',
    name: 'App Store',
    description: 'Store reviews & ratings',
    placeholder: 'App Store URL or ID',
    value: '',
    status: 'idle',
  },
]

export const LOADING_TASKS = [
  'Reading GitHub issues...',
  'Scanning store reviews...',
  'Building knowledge graph...',
  'Creating product memory...',
  'Analyzing user feedback...',
  'Generating initial insights...',
]
