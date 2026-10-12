import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Analyse statique du code (pnpm lint). Sans les informations de types, pour rester rapide :
// les types restent l'affaire de tsc (pnpm typecheck) et la mise en forme celle de Prettier.
export default defineConfig([
  globalIgnores([
    '**/dist/',
    '**/build/',
    '**/node_modules/',
    '**/coverage/',
    '**/test-results/',
    '**/playwright-report/',
    'apps/desktop/src-tauri/',
    'crates/',
    '**/target/',
    '**/public/',
    'design/',
    '**/*.generated.ts',
    '.claude/',
  ]),

  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // Le verrouillage d'axe à la touche Maj s'écrit `cond ? (dy = 0) : (dx = 0)` dans tout le
      // code : un ternaire dont chaque branche agit reste permis, les expressions sans effet non.
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
    },
  },

  // Règles des hooks, dans l'éditeur seulement : les paquets n'utilisent pas React. Les dépendances
  // des effets sont déjà tenues à jour (les rares exceptions voulues sont commentées sur place) :
  // la règle reste une erreur.
  {
    files: ['apps/editor/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // Environnements d'exécution de chaque dossier.
  {
    files: ['apps/editor/src/**/*.{ts,tsx}'],
    ignores: ['**/*.worker.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/editor/src/**/*.worker.ts'],
    languageOptions: { globals: globals.worker },
  },
  {
    // Code partagé par la page et les Web Workers de l'éditeur.
    files: ['packages/*/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
  },
  {
    // Tests du moteur (Vitest), scripts de construction et configurations.
    files: ['packages/*/test/**/*.ts', '**/scripts/**/*.mjs', 'apps/editor/*.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Tests de bout en bout : Node, et le navigateur dans les fonctions passées à page.evaluate.
    files: ['apps/editor/e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // Les tests lisent le document et les crochets de test (window.poulpe) sans leurs types :
      // `any` y est voulu, le typer partout n'apporterait rien. La règle reste active ailleurs.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Extensions : scripts (pas des modules) exécutés dans l'interpréteur QuickJS, où le prélude
    // définit l'objet `poulpe` ; ni le navigateur ni Node n'y sont disponibles.
    files: ['apps/editor/src/extensions/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { poulpe: 'readonly' } },
  },
]);
