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
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
])
