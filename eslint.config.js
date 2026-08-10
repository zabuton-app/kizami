import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['node_modules/', 'out/', 'dist/', 'release/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts that drive the built app. Playwright serialises some of the
    // callbacks in them into the app, so browser globals appear here too.
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        document: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly'
      }
    }
  },
  prettier
)
