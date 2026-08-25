/**
 * Sign a browser in with the workspace API key.
 *
 * WHY THE SUITE NEEDS THIS
 * A browser needs a cookie, and the only way to get one used to be
 * `POST /api/auth/sign-in/email` with the system user's password. In a default
 * workspace that password is generated locally into `.b1/env/.env.local` while
 * `AUTHENTICATION_SERVER_TYPE` is `remote`, so it matches no user on the shared
 * auth server and the login 401s. The API key is the credential such a
 * workspace actually has.
 *
 * HOW
 * The auth server issues a single-use, 60-second handoff code to an
 * authenticated caller; the app server's `/service/swat/mcp/sso` endpoint redeems it
 * server-side and forwards the resulting `Set-Cookie` to the browser, adapting
 * it for a plain-http origin on the way. Both endpoints already existed for the
 * MCP iframe SSO flow — all that was added was the auth server accepting
 * `x-api-key` as a credential that may mint a code.
 *
 * WHY THIS IS NOT IMPORTED FROM THE CLI
 * `@buildone/swat-cli` is a published, customer-facing package; a test harness
 * must not be a reason to keep it importable, and the dependency would point
 * the wrong way. The key-resolution rule below is deliberately the same one as
 * `src/cli/scripts/devcontainer/lib/api-key.sh` and
 * `src/cli/scripts/utils/api-key.mjs` — if it changes, it changes in all three.
 */

/**
 * The auth server a URL names, as an environment-variable-name fragment: host
 * only (no scheme, userinfo, port or path), dots and dashes to underscores,
 * uppercased.
 */
export function authHostSlug(url: string | undefined): string | null {
  if (!url) return null;

  let host = url.replace(/^[^:]*:\/\//, ''); // scheme
  host = host.split('/')[0]; // path
  host = host.split('?')[0];
  host = host.slice(host.lastIndexOf('@') + 1); // userinfo
  host = host.split(':')[0]; // port
  if (host === '') return null;

  const slug = host.replace(/[.-]/g, '_').toUpperCase();
  return /^[A-Z0-9_]+$/.test(slug) ? slug : null;
}

/**
 * The API key the suite authenticates with, most specific name first.
 *
 * B1_E2E_API_KEY IS THE ONE THAT SHOULD BE SET. It belongs to a dedicated test
 * user, and the point of a dedicated user is that the suite runs as the SAME
 * person in every workspace. A developer's personal key does not: it makes the
 * signed-in identity vary per machine, and this suite has fixtures that are
 * owned by a user and only visible to their owner (drafts on the vibecode
 * screens, private saved filters). Under a personal key those tests pass or
 * fail according to whose key happened to be in the environment, which is worse
 * than failing consistently — it is a suite that cannot be trusted either way.
 *
 * The personal key remains as a fallback so a workspace without the shared
 * secret still runs, but `whichIdentity()` reports when that happens rather
 * than letting it pass for the intended setup.
 *
 * A key is a row in one auth server's database and 401s at every other, so the
 * name carrying that server's host wins over the bare one. Organization keys
 * are never considered: they authenticate as the organization, which is not a
 * person, and a session has to belong to somebody.
 */
export function resolveApiKey(
  authUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): { name: string; key: string; dedicated: boolean } | null {
  const slug = authHostSlug(authUrl ?? env.AUTH_URL);
  const candidates = [
    ...(slug ? [{ name: `B1_E2E_API_KEY__${slug}`, dedicated: true }] : []),
    { name: 'B1_E2E_API_KEY', dedicated: true },
    ...(slug ? [{ name: `B1_USER_API_KEY__${slug}`, dedicated: false }] : []),
    { name: 'B1_USER_API_KEY', dedicated: false }
  ];

  for (const { name, dedicated } of candidates) {
    const value = env[name];
    if (value) return { name, key: value, dedicated };
  }
  return null;
}

/**
 * Ask the auth server for a single-use handoff code.
 *
 * @throws when there is no AUTH_URL, no usable key, or the server refuses —
 *   including the case that matters most in practice: an auth server deployed
 *   without the `x-api-key` handoff branch, which answers 401 here.
 */
export async function issueHandoffCode(
  appUrl: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ code: string; keyVar: string; dedicated: boolean }> {
  // AUTH_URL NAMES the auth server; appUrl is how we REACH it. With a remote
  // auth server AUTH_URL is a public HTTPS URL, but with a local one it
  // defaults to `http://auth_server:3000` — a compose-internal name that does
  // not resolve from the host, where this suite runs. So the request goes
  // through the app's auth proxy, which forwards `x-api-key` along with every
  // other non-hop-by-hop header and reaches the same endpoint either way. The
  // key is still resolved by AUTH_URL's host, which names where it was minted.
  const authServer = (env.AUTH_URL ?? '').replace(/\/+$/, '');
  const base = appUrl.replace(/\/+$/, '');

  const resolved = resolveApiKey(authServer, env);
  if (!resolved) {
    throw new Error(
      `no API key for ${authServer || base} — set B1_E2E_API_KEY to the dedicated test user's key ` +
        '(see src/e2e/README.md), or mint a personal one (Account > API keys) with `b1 api-key set <key>`'
    );
  }

  const response = await fetch(`${base}/api/auth/mcp/handoff/issue`, {
    method: 'POST',
    headers: { 'x-api-key': resolved.key, 'Content-Type': 'application/json' },
    body: '{}'
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `${resolved.name} was refused by ${authServer || base} (HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}) — ` +
        'an auth server without the x-api-key handoff branch answers 401 here'
    );
  }

  const body = (await response.json()) as { code?: string };
  if (!body?.code) throw new Error(`handoff issued no code (HTTP ${response.status} from ${base})`);

  return { code: body.code, keyVar: resolved.name, dedicated: resolved.dedicated };
}

/**
 * The e-mail of the user the current session belongs to.
 *
 * Ask, never assume. Which user the suite runs as now depends on how it signed
 * in: the API-key path authenticates as the key's *owner*, the password path as
 * the system user. A test that grants a role to one identity and then asserts
 * against the other's session passes or fails for reasons that have nothing to
 * do with what it is testing.
 */
export async function getSignedInEmail(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  if (!response.ok()) throw new Error(`could not read the current session (HTTP ${response.status()})`);

  const body = (await response.json()) as { user?: { email?: string } } | null;
  const email = body?.user?.email;
  if (!email) throw new Error('the current session carries no user e-mail');

  return email;
}

/**
 * The URL that signs a browser in and lands it on `target`. The code is
 * single-use and short-lived, so navigate to this immediately.
 */
export async function browserSessionUrl(
  appUrl: string,
  target = '/',
  env: NodeJS.ProcessEnv = process.env
): Promise<{ url: string; keyVar: string; dedicated: boolean }> {
  const { code, keyVar, dedicated } = await issueHandoffCode(appUrl, env);
  const base = appUrl.replace(/\/+$/, '');

  // `/service/swat/mcp/sso` rejects anything that is not a same-origin relative path, so a
  // bad target lands on `/` rather than becoming an open redirect. Encode it
  // regardless — a target with a query of its own must not merge into ours.
  const to = encodeURIComponent(target.startsWith('/') ? target : `/${target}`);
  return { url: `${base}/service/swat/mcp/sso?code=${encodeURIComponent(code)}&to=${to}`, keyVar, dedicated };
}
