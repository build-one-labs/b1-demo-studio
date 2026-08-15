import globals from 'globals';
import tsParser from '@typescript-eslint/parser';

/**
 * ESLint configuration for the Demo Factory pipeline (demo-factory/).
 *
 * Deliberately minimal rather than the monorepo base config: this tree is
 * vendored from build-one-labs/b1-demo-factory and should stay diffable
 * against upstream — reformatting it to the host repo's style would turn
 * every future sync into a conflict. The globals are the honest part: the
 * pipeline runs under Node, and several action helpers execute inside the
 * recorded page via page.evaluate, so browser globals are real there too.
 *
 * The app server's `lint` script runs this over demo-factory/ explicitly and
 * its own config ignores the folder, which is what keeps the two apart.
 *
 * @type { import("eslint").Linter.Config[] }
 */
export default [
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {...globals.node, ...globals.browser},
    },
  },
  {
    // The Remotion composition — TypeScript/JSX, so it needs the TS parser.
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {...globals.node, ...globals.browser},
    },
  },
  {ignores: ['**/node_modules/**', '**/output/**', '**/public/**', '**/.cache/**', '**/playwright/**']},
];
