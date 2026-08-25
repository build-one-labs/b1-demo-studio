import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { getBaseURL, getSystemUserEmail, getSystemUserPassword } from '../utils/env';
import { browserSessionUrl, getSignedInEmail } from '../utils/session';

const STORAGE_STATE = '.auth/user.json';

/**
 * Authenticate once and persist the session so the test projects can reuse it
 * via `storageState`. Runs as the `setup` project before every other project.
 *
 * Two ways in, in order:
 *
 *   1. The workspace API key, exchanged for a session cookie through the auth
 *      server's handoff endpoint. This is the only one that works in a default
 *      workspace: B1_SYSTEM_USER_PASSWORD is generated locally into
 *      .b1/env/.env.local while AUTHENTICATION_SERVER_TYPE is `remote`, so it
 *      matches no user on the shared auth server and the form login below
 *      simply 401s.
 *   2. The system-user form login, which is still exactly right for a workspace
 *      running its own auth server — there the generated password *is* the
 *      local system user's — and for anyone pointing the suite at an
 *      environment where they hold real credentials.
 *
 * Both end in the same place: a cookie in storageState. Tests never know which
 * ran. `LoginPage` remains the way to exercise the login screen itself.
 */
setup('authenticate', async ({ page }) => {
  const failures: string[] = [];

  let signedIn = await signInWithApiKey(page).catch((e: Error) => {
    failures.push(`API key: ${e.message}`);
    return false;
  });

  if (!signedIn) {
    signedIn = await signInWithPassword(page).catch((e: Error) => {
      failures.push(`Password: ${e.message}`);
      return false;
    });
  }

  if (!signedIn) {
    throw new Error(
      `Could not authenticate the E2E suite. Tried, in order:\n  ${failures.join('\n  ')}\n\n` +
        'The API key is the credential a default workspace has: mint one in the app ' +
        '(Account > API keys) and set it with `b1 api-key set <key>`. See src/e2e/README.md.'
    );
  }

  // An app that gates un-onboarded users into /onboarding would otherwise send
  // every spec there instead of to the screen it asked for. Marking the user
  // onboarded is a courtesy, not a requirement: an app without the onboarding
  // flow answers 404 here, and that is not a failed sign-in — so it is reported
  // and the session is saved regardless.
  const onboarded = await page.request
    .post('/service/swat/server-actions/user-profile/set-custom-property', {
      data: { Context: 'onboarding', CustomPropertyObject: { onboardingCompleted: true } }
    })
    .catch(() => null);
  if (!onboarded?.ok()) {
    console.log('[e2e] could not mark the user onboarded — continuing with the session as it is');
  }

  await page.context().storageState({ path: STORAGE_STATE });
});

/**
 * Exchange the workspace API key for a session cookie.
 *
 * The handoff code is single-use and expires in 60 seconds, so it is minted
 * and immediately navigated to. /mcp/sso redeems it on the app server and
 * forwards the cookie, adapting it for a plain-http origin on the way.
 */
async function signInWithApiKey(page: import('@playwright/test').Page): Promise<boolean> {
  const { url, keyVar, dedicated } = await browserSessionUrl(getBaseURL(), '/');

  await page.goto(url);
  await expect(page).not.toHaveURL(/\/sign-in/);

  // Say who the suite is, every run. A spec that asserts against data only its
  // owner can see passes for one person and fails for the next, and a run that
  // does not name its user leaves you comparing failures that were never
  // comparable.
  const email = await getSignedInEmail(page.request);
  console.log(`[e2e] signed in as ${email} (${keyVar})`);
  if (!dedicated) {
    console.warn(
      `[e2e] WARNING: ${keyVar} is a personal key, not the dedicated test user's. Owner-scoped ` +
        'fixtures belong to the test user, so expect failures that say nothing about the code. ' +
        'Set B1_E2E_API_KEY — see src/e2e/README.md.'
    );
  }
  return true;
}

/** The form login, for a workspace whose auth server knows this password. */
async function signInWithPassword(page: import('@playwright/test').Page): Promise<boolean> {
  const password = getSystemUserPassword();
  if (!password) throw new Error('B1_SYSTEM_USER_PASSWORD is not set');

  const loginPage = new LoginPage(page);
  await loginPage.open();
  await loginPage.login(getSystemUserEmail(), password);
  await expect(page).not.toHaveURL(/\/sign-in/);
  return true;
}
