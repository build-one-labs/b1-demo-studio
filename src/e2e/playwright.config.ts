import { defineConfig, devices } from '@playwright/test';
import { getBaseURL } from './utils/env';

/**
 * Playwright configuration for the Build.One web-app E2E suite.
 *
 * Tests run against the full running stack (Caddy + web-app + auth + backend)
 * at http://localhost:8080 — start it with `b1 up` BEFORE running tests.
 * There is deliberately no `webServer` block: spawning a bare `nuxt dev`
 * would bypass Caddy/auth and break authentication.
 *
 * The `setup` project authenticates once and stores the session in
 * `.auth/user.json`; every other project reuses it via `storageState`.
 */
export default defineConfig({
  testDir: './tests',
  // Fail the build on CI if test.only is left in the source.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  /**
   * The stack under test runs in DEV mode: the first visit to a screen compiles
   * its route on demand, and the CI runner shares four cores between that
   * compile, the two app servers and two browsers. The default 30s is enough on
   * a developer's workspace but turns ordinary first-visit latency into failures
   * there, so CI gets double.
   */
  timeout: process.env.CI ? 60_000 : 30_000,
  /**
   * Assertions get the same headroom for the same reason. The default 5s is a
   * fair budget for "this should already be on screen" on a warm workspace; on
   * CI the same wait covers a screen still being compiled and fetched, and the
   * failure it produces then ("element(s) not found") says nothing about the
   * feature under test.
   */
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  // Parallelize spec files in CI while leaving tests within each stateful spec
  // sequential. Two browsers leave enough memory for the full local stack;
  // E2E_WORKERS allows larger runners and manual runs to tune this upward.
  workers: process.env.CI ? Number(process.env.E2E_WORKERS ?? 2) : undefined,
  // The JSON report is in both lists on purpose: it is what the CLI's
  // `scripts/reports/e2e-report.mjs` reads to produce the human-readable
  // summary, and a summary you can only get from CI is one nobody checks
  // before pushing. `yarn workspace @buildone/e2e report` renders it locally
  // (in a customer repository, `yarn workspace e2e report`).
  // `github` adds inline file annotations on the run — CI only, since outside
  // Actions it prints nothing useful.
  reporter: process.env.CI
    ? [
        ['list'],
        ['github'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['junit', { outputFile: 'test-results/e2e-junit.xml' }],
        ['json', { outputFile: 'test-results/e2e-results.json' }]
      ]
    : [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['json', { outputFile: 'test-results/e2e-results.json' }]
      ],

  use: {
    baseURL: getBaseURL(),
    // Full Chromium in new-headless mode: the stripped chromium-headless-shell
    // renderer crashes under the devcontainer's memory pressure.
    channel: 'chromium',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Recording screencasts costs the renderer real memory; allow opting out
    // on constrained machines (E2E_VIDEO=off).
    video: process.env.E2E_VIDEO === 'off' ? 'off' : 'retain-on-failure'
  },

  projects: [
    // 1. Authenticate once, save the session to .auth/user.json.
    {
      name: 'setup',
      testDir: './setup',
      testMatch: /.*\.setup\.ts/
    },

    // 2. Authenticated test runs reuse the saved session.
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json'
      },
      dependencies: ['setup']
    }

    // Enable additional browsers when cross-browser coverage is needed:
    // {
    //   name: 'firefox',
    //   use: {...devices['Desktop Firefox'], storageState: '.auth/user.json'},
    //   dependencies: ['setup'],
    // },
    // {
    //   name: 'webkit',
    //   use: {...devices['Desktop Safari'], storageState: '.auth/user.json'},
    //   dependencies: ['setup'],
    // },
  ]
});
