const globals = require('globals');

const mainConfig = require('../../eslint.config');

/**
 * Backend (NestJS) ESLint configuration
 * Extends root config with Node.js/NestJS specific settings
 * @type { import("eslint").Linter.Config[] }
 */
module.exports = [
  // The Demo Factory pipeline is linted with its own, deliberately minimal
  // config (demo-factory/eslint.config.mjs) — see the `lint` script. Vendored
  // ESM that stays diffable against upstream, not NestJS code.
  { ignores: ['demo-factory/**'] },
  ...mainConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },
    rules: {
      // NestJS allows decorators which trigger explicit-any warnings
      '@typescript-eslint/no-explicit-any': 'off',

      // NestJS uses decorators extensively
      '@typescript-eslint/no-inferrable-types': 'off',

      // Allow empty constructors (common in NestJS for DI)
      '@typescript-eslint/no-empty-function': [
        'error',
        {
          allow: ['constructors']
        }
      ],

      // Allow console in server applications for logging
      'no-console': 'off',

      // Drizzle ORM uses some patterns that trigger security warnings
      'security/detect-object-injection': 'off',

      // NestJS uses class-based architecture with this context
      'unicorn/no-this-assignment': 'off',

      // Test files may have specific patterns
      'sonarjs/no-duplicate-string': 'off'
    }
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', 'test/**/*.ts'],
    rules: {
      // Allow any in test files
      '@typescript-eslint/no-explicit-any': 'off',
      // Security rules less critical in tests
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off'
    }
  }
];
