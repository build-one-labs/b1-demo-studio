# e2e — End-to-End tests (Playwright)

End-to-end tests for this application, driven by [Playwright](https://playwright.dev).
Tests run against the **full running stack** (Caddy + web-app + auth + backend),
not an isolated dev server.

## Prerequisites

1. **Stack running** — start it first; tests hit `http://localhost:8080`:
   ```bash
   b1 up
   ```
2. **Chromium**:
   ```bash
   yarn workspace e2e exec playwright install --with-deps chromium
   ```
3. **Credentials** — the suite authenticates as a **dedicated test user**, via
   that user's API key in `B1_E2E_API_KEY` (or `B1_E2E_API_KEY__<HOST>` when a
   workspace talks to more than one auth server). Store it centrally as an
   organization secret so every workspace and every CI run picks it up.

   **Why a dedicated user and not your own key.** A spec that asserts against
   data *owned by* a user and only visible to its owner passes or fails
   according to whose key is in the environment. A suite whose result depends on
   the machine it runs on cannot be trusted in either direction, so the identity
   is pinned.

   If `B1_E2E_API_KEY` is unset the suite falls back to your personal key
   (`B1_USER_API_KEY`) and **warns**. Every run prints the identity it used:
   ```
   [e2e] signed in as e2e@example.com (B1_E2E_API_KEY)
   ```
   ```bash
   b1 api-key check          # is this workspace's key valid at its auth server?
   ```
   To target another environment, set `E2E_BASE_URL` and the key for that auth
   server — see [`.env.example`](./.env.example).

## Running

```bash
# All tests (headless)
yarn workspace e2e test:e2e

# Interactive UI mode (best for authoring)
yarn workspace e2e test:e2e:ui

# A single suite or file
yarn workspace e2e test:e2e tests/smoke
yarn workspace e2e test:e2e tests/smoke/app-loads.spec.ts

# Open the last HTML report
yarn workspace e2e test:e2e:report

# Record a new test against the running app
yarn workspace e2e codegen
```

## How authentication works

A dedicated `setup` project (`setup/auth.setup.ts`) signs in once and saves the
browser session to `.auth/user.json` (gitignored). Every browser project depends
on `setup` and reuses that session through `storageState`, so individual tests
start already authenticated — no repeated logins. For tests that exercise login
itself, use the `LoginPage` page object directly.

Signing in has two paths, tried in order:

1. **The workspace API key.** A browser needs a cookie, and a key is a header —
   so the key is exchanged for one: the auth server issues a single-use,
   60-second handoff code (`/api/auth/mcp/handoff/issue`), and the app server's
   `/service/swat/mcp/sso` endpoint redeems it and forwards the `Set-Cookie`.
   This is the only path that works in a **default workspace**, where
   `AUTHENTICATION_SERVER_TYPE` is `remote` and `B1_SYSTEM_USER_PASSWORD` is
   generated locally — so it matches no user on the shared auth server.
2. **The system-user form login**, via `LoginPage`. Right for a workspace
   running its **own** auth server, and for anyone holding real credentials for
   the environment they are pointing at.

If both fail the error names each attempt and why — including the API-key
variable it resolved and the status the auth server answered.

## Project structure

```
src/e2e/
├── playwright.config.ts   # config: baseURL, projects (setup + chromium), reporters
├── setup/auth.setup.ts    # one-time login → .auth/user.json
├── pages/                 # Page Object Model — one class per screen
│   ├── BasePage.ts        #   shared navigation/wait helpers
│   └── LoginPage.ts       #   /sign-in selectors + login() action
├── fixtures/test.ts       # extended `test` exposing page objects as fixtures
├── utils/env.ts           # typed env accessors (baseURL, system-user creds)
├── utils/session.ts       # API key → browser session handoff
└── tests/
    ├── smoke/             # quick validation of critical paths
    ├── sanity/            # basic functionality verification
    └── regression/        # comprehensive feature coverage
```

## Writing a test (Page Object Model)

1. **Add a page object** under `pages/` — one class per screen, extending
   `BasePage`, exposing locators and high-level actions (not raw selectors in
   tests). Prefer `name`, role, or text selectors; add `data-testid` to the
   component when a stable hook is needed.
2. **Expose it as a fixture** in `fixtures/test.ts` if tests will use it often.
3. **Write the spec** under the appropriate `tests/<suite>/` folder, importing
   `{test, expect}` from `../../fixtures/test`:

   ```ts
   import {test, expect} from '../../fixtures/test';

   test('opens the dashboard', async ({page}) => {
     await page.goto('/');
     await expect(page).not.toHaveURL(/\/sign-in/);
   });
   ```

## CI

`.github/workflows/e2e.yml` runs the suite on a GitHub runner: it creates or
reuses a dedicated Neon database branch, launches a disposable full stack,
imports fresh data and runs the suite against `http://localhost:8080`. The HTML
report, JUnit XML, stack diagnostics and failure traces are kept as the
`e2e-results` artifact for seven days.

It runs nightly, and on demand from **Actions → E2E → Run workflow** — where the
`workers` input tunes Playwright's concurrency for a larger runner. Spec files
run in parallel; tests within one spec stay sequential so they can share data.

The run needs `AUTH_URL` and `B1_ORG_API_KEY` in the repository's Actions
secrets; everything else it needs (the AWS pair, the Neon credentials, the test
user's key) is fetched from the secret store with them. A scheduled run in a
repository that has not provisioned that pair yet ends early with a notice
rather than a failure.

## Notes

- There is intentionally **no Playwright `webServer`** block — the app must be
  served by the full stack (`b1 up`). A bare `nuxt dev` would bypass Caddy/auth.
- Cross-browser (Firefox/WebKit) projects are scaffolded but disabled — see the
  commented projects in `playwright.config.ts`.
