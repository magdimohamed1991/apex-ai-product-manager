import type { RepositoryFiles } from '@apex/analysis'

/**
 * Mock repository files that simulate the APEX repo itself.
 * Used for demo — no real GitHub API call needed.
 */
export const MOCK_APEX_REPOSITORY: RepositoryFiles = {
  url: 'https://github.com/magdimohamed1991/apex-ai-product-manager',
  packageJson: {
    name: 'apex-ai-product-manager',
    private: true,
    type: 'module',
    dependencies: {
      react: '^19.2.8',
      'react-dom': '^19.2.8',
      tailwindcss: '^4.3.3',
      'tailwind-variants': '^3.3.1',
      clsx: '^2.1.1',
      'tailwind-merge': '^3.6.0',
    },
    devDependencies: {
      typescript: '~6.0.2',
      vite: '^8.2.0',
      turbo: '^2.10.8',
      husky: '^9.1.7',
    },
  },
  hasDockerfile: false,
  hasPnpmWorkspace: true,
  hasTurboJson: true,
  hasGitHubActions: true,
  hasJestConfig: false,
  hasVitestConfig: false,
  hasTailwindConfig: true,
  hasTypeScriptConfig: true,
  fileList: [
    'package.json',
    'pnpm-workspace.yaml',
    'turbo.json',
    'tsconfig.json',
    '.github/workflows/ci.yml',
  ],
}
