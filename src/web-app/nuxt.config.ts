import { fileURLToPath } from 'node:url';

import { transformWithEsbuild } from 'vite';

// The vendored demo factory (src/demo-factory) is a standalone npm project, not
// a yarn workspace — React/Remotion must not hoist into this Vue tree. The app
// still renders its Remotion composition on the DemoFactoryScreen, so the
// composition sources are aliased in directly and Vite is told to resolve React
// and Remotion from ONE place: two copies of `remotion` would put the Player and
// the composition in different contexts, and useCurrentFrame() would never fire.
const demoFactoryRemotion = fileURLToPath(new URL('../demo-factory/src/remotion', import.meta.url));

/** The vendored React/Remotion sources, which must not meet the Vue JSX transform. */
const demoFactoryTsx = /[\\/]src[\\/]demo-factory[\\/].*\.tsx$/;

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  srcDir: 'src',
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  telemetry: false,
  extends: ['@buildone/web-framework-layer'],
  modules: ['@nuxt/eslint', '@nuxt/image'],
  alias: {
    '@demo-factory': demoFactoryRemotion
  },
  vite: {
    // The composition is .tsx; Vite's esbuild reads this app's tsconfig, not the
    // demo factory's, so the React 19 automatic runtime is declared here.
    esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
    // Nuxt always registers @vitejs/plugin-vue-jsx, and it claims EVERY .tsx.
    // Left alone it compiles the demo factory's React components to Vue
    // createVNode() calls, and React then rejects its own component's output
    // with "Objects are not valid as a React child ({__v_isVNode, ...})".
    // The app keeps Vue JSX everywhere except the vendored React tree.
    vueJsx: { exclude: [demoFactoryTsx] },
    // ...which leaves nobody to compile that JSX: Vite's own esbuild pass reads
    // the tsconfig it discovers for the file, and the demo factory's sits
    // outside this app's root, so the JSX survives to import-analysis and fails
    // to parse. Transform it here instead — explicit beats discovery across a
    // package boundary.
    plugins: [
      {
        name: 'demo-factory-react-jsx',
        enforce: 'pre',
        transform(code: string, id: string) {
          if (!demoFactoryTsx.test(id)) return null;
          return transformWithEsbuild(code, id, {
            loader: 'tsx',
            jsx: 'automatic',
            jsxImportSource: 'react'
          });
        }
      }
    ],
    resolve: { dedupe: ['react', 'react-dom', 'remotion', '@remotion/player'] }
  },
  app: {
    head: {
      title: 'BuildOne Application',
      link: [{ rel: 'icon', type: 'image/x-icon', href: '/favicon.svg' }]
    }
  }
});
