import prettierConfigRecommended from 'eslint-plugin-prettier/recommended';

import withNuxt from './.nuxt/eslint.config.mjs';

/**
 * Frontend (Nuxt/Vue) ESLint configuration
 * Extends Nuxt's auto-generated config with custom rules
 */
export default withNuxt([
  prettierConfigRecommended,
  {
    rules: {
      // Prettier configuration
      quotes: ['error', 'single'],
      'prettier/prettier': [
        'error',
        {
          singleQuote: true,
          trailingComma: 'none',
          printWidth: 120
        }
      ],

      // TypeScript rules
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],

      // Vue component rules
      'vue/multi-word-component-names': 'off',
      'vue/valid-attribute-name': 'off',
      'vue/no-v-html': 'off',
      'vue/require-default-prop': 'off',

      // Vue formatting rules
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-self-closing': [
        'error',
        {
          html: {
            void: 'always',
            normal: 'always',
            component: 'always'
          },
          svg: 'always',
          math: 'always'
        }
      ],

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

      // General rules
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',

      // Nuxt auto-imports may trigger these
      'no-undef': 'off',

      // Composables may use specific patterns
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/filename-case': 'off'
    }
  }
]);
