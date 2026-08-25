import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Honour the leading-underscore convention for intentionally-unused bindings.
      //
      // `lib/v2adapters.ts` keeps v1's exact signatures so the panels that call them needed an
      // import swap and nothing else — which means carrying parameters the v2 contracts have no use
      // for (`positionId`, where v2 has no positions; `minPtOut`, where the router derives its own
      // floor). Renaming them would break the drop-in property that made the migration one file
      // instead of twenty; deleting them would break the call sites. Marking them is the honest
      // third option, and this makes the marking mean something.
      // Keep the migration from quietly reversing.
      //
      // `lib/{spield,vault,market}` still address the **v1** contracts, which are live on mainnet
      // and legitimately readable — but nothing in the dashboard should call them any more. Type
      // imports stay allowed: those modules still define the shapes `ProtocolContext` exposes, and
      // a type cannot reach a contract.
      //
      // Without this, the next person to add a helper to `lib/market` gets it silently wired into a
      // v2 page, and the failure would be a chart quietly reading an empty v1 pool rather than
      // anything that throws.
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/spield',
              message: 'v1 contracts. Use @/lib/v2adapters instead (type imports are fine).',
              allowTypeImports: true,
            },
            {
              name: '@/lib/vault',
              message: 'v1 contracts. Use @/lib/v2adapters instead (type imports are fine).',
              allowTypeImports: true,
            },
            {
              name: '@/lib/market',
              message: 'v1 contracts. Use @/lib/v2adapters instead (type imports are fine).',
              allowTypeImports: true,
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
])
