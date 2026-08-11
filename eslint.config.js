const js = require('@eslint/js');
const importPlugin = require('eslint-plugin-import');
const json = require('eslint-plugin-json');
const node = require('eslint-plugin-n');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');
const securityPlugin = require('eslint-plugin-security');
const unicornPlugin = require('eslint-plugin-unicorn');
const ts = require('typescript-eslint');

/**
 * Root ESLint configuration
 * This config is used for files in the root directory and as a base for other workspaces
 * @type { import("eslint").Linter.Config[] }
 */
module.exports = [
  // Base configurations
  js.configs.recommended,
  ...ts.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  securityPlugin.configs.recommended,
  {
    plugins: {
      unicorn: unicornPlugin
    }
  },
  eslintPluginPrettierRecommended,
  node.configs['flat/recommended'],

  // Common rules
  {
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unused-expressions': 'off', // Disable due to config issue
      '@typescript-eslint/no-require-imports': 'off', // Allow require in config files

      // Import rules
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true
          }
        }
      ],
      'import/no-duplicates': 'error',
      'import/no-unresolved': 'off', // TypeScript handles this
      'import/named': 'off', // TypeScript handles this
      'import/namespace': 'off', // TypeScript handles this
      'import/default': 'off', // TypeScript handles this

      // General rules
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',

      // Node plugin rules - disable for monorepo compatibility
      'n/no-extraneous-import': 'off',
      'n/no-missing-import': 'off',
      'n/no-unpublished-import': 'off',

      // Unicorn rules (selective best practices)
      'unicorn/better-regex': 'error',
      'unicorn/catch-error-name': 'error',
      'unicorn/consistent-function-scoping': 'error',
      'unicorn/explicit-length-check': 'error',
      'unicorn/filename-case': 'off', // Different conventions in different projects
      'unicorn/no-array-for-each': 'off', // forEach is fine
      'unicorn/no-null': 'off', // null is used in many APIs
      'unicorn/prefer-module': 'off', // Using CommonJS in configs
      'unicorn/prefer-top-level-await': 'off', // Not always appropriate
      'unicorn/prevent-abbreviations': 'off' // Too strict
    }
  },

  // JSON file configuration
  {
    files: ['**/*.json'],
    ignores: ['**/tsconfig*.json'], // tsconfig.json supports comments (JSONC)
    ...json.configs['recommended']
  },

  // Ignore patterns
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.nuxt/**',
      '**/coverage/**',
      '**/.yarn/**',
      '**/.pnp.*',
      '**/build/**',
      '**/out/**',
      '**/.devcontainer/**',
      '**/drizzle/**'
    ]
  }
];
