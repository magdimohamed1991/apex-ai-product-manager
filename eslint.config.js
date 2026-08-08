import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.turbo/**',
    '**/build/**',
    '**/*.config.*',
    // apps/ has its own eslint.config.js — excluded from root lint
    'apps/**',
  ],
  rules: {
    // Allow underscore-prefixed parameters and variables to indicate intentional non-use.
    // Standard TypeScript convention for abstract hook stubs and unused destructured args.
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        vars: 'all',
        args: 'all',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
  },
})
