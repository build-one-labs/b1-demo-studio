/**
 * Mints a Playwright storage state for the demo recording, from this
 * workspace's API key.
 *
 * The factory's own `capture-auth.mjs` opens a headed browser and waits for a
 * human to log in — right for a foreign environment, useless in a workspace,
 * where the default auth server is remote and the generated system-user
 * password matches no user (see CLAUDE.md → "Local Web-App Login"). The E2E
 * suite solved this: exchange the workspace API key for a session cookie via
 * the auth server's single-use handoff code. This tool is that exchange,
 * shaped as demo-factory infrastructure.
 *
 * Writes `playwright/.auth/b1-demo-user.json` (gitignored) and prints the
 * path — point `B1_AUTH_STATE` at it. The handoff code lives 60 seconds, so
 * the state is minted immediately before a recording, not stored long-term.
 */
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';
import {loadDotEnv} from '../src/lib/env.mjs';

// Same reason as capture-auth.mjs: a separate entry point needs the .env too.
await loadDotEnv();

// The one place that knows the handoff flow — reused, not copied, so a change
// to the auth exchange cannot strand the demo recorder. It has two homes: in
// the framework monorepo it is CLI source, and in a product repo the identical
// file ships inside @buildone/swat-cli. Try both rather than assume either.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const sessionCandidates = [
  path.join(repoRoot, 'src', 'cli', 'scripts', 'utils', 'browser-session.mjs'),
  path.join(repoRoot, 'node_modules', '@buildone', 'swat-cli', 'scripts', 'utils', 'browser-session.mjs'),
];
const sessionModule = sessionCandidates.find((candidate) => existsSync(candidate));
if (!sessionModule) throw new Error(`browser-session.mjs not found. Looked in:\n  ${sessionCandidates.join('\n  ')}`);
const {browserSessionUrl} = await import(pathToFileURL(sessionModule).href);

// Every application the demo opens: a demo may start in one app and show the
// result in another (B1_BASE_URLS, comma-separated, from run-demo.mjs). One
// browser context signs in to each in turn, so the one storage state written
// at the end carries a session cookie for every origin.
const baseUrls = [...new Set(
  (process.env.B1_BASE_URLS || process.env.B1_BASE_URL || 'http://localhost:8080')
    .split(',')
    .map((url) => url.trim().replace(/\/+$/, ''))
    .filter(Boolean),
)];
// The file the take will read: a demo with its own demo user gets its own file
// (B1_AUTH_STATE from the server), so one user's session never signs in another's take.
const authFile = process.env.B1_AUTH_STATE
  ? path.resolve(process.env.B1_AUTH_STATE)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'playwright', '.auth', 'b1-demo-user.json');
await mkdir(path.dirname(authFile), {recursive: true});

// The same rule as record.mjs and render.mjs: a slim container cannot run
// Playwright's managed download, so it ships one system Chromium and every
// browser user is pointed at it. Without this the mint is the only step still
// looking for the managed build — it dies with "Executable doesn't exist at
// …/.cache/ms-playwright/chromium_headless_shell-…" on a host where the
// recording it exists to authenticate runs perfectly well.
const browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
const failures = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const baseUrl of baseUrls) {
    try {
      const {url, keyVar} = await browserSessionUrl({appUrl: baseUrl, target: '/'});
      await page.goto(url, {waitUntil: 'networkidle'});
      if (/\/sign-in/.test(page.url())) throw new Error(`the handoff landed on the sign-in page (${keyVar} rejected?)`);

      // The customer app gates un-onboarded users into /onboarding; a demo that
      // opens on the onboarding wizard instead of its screen is a ruined take.
      const onboarded = await page.request.post(`${baseUrl}/service/swat/server-actions/user-profile/set-custom-property`, {
        data: {Context: 'onboarding', CustomPropertyObject: {onboardingCompleted: true}},
      });
      if (!onboarded.ok()) throw new Error(`could not mark the demo user as onboarded (${onboarded.status()})`);
      console.log(`Signed in to ${baseUrl} via ${keyVar}`);
    } catch (error) {
      failures.push(`${baseUrl}: ${error.message}`);
      console.warn(`Could not sign in to ${baseUrl}: ${error.message}`);
    }
  }
  if (failures.length === baseUrls.length) throw new Error(failures.join('; '));
  await context.storageState({path: authFile});
  console.log(`Auth state written to ${authFile} (${baseUrls.length - failures.length} of ${baseUrls.length} applications)`);
} finally {
  await browser.close();
}
