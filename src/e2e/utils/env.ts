/**
 * Typed accessors for the environment configuration the E2E suite needs.
 *
 * The suite authenticates the way the rest of the workspace does — with the
 * dedicated test user's API key — and keeps that user's password only as a
 * fallback for a local-auth workspace, where the auth server seeds the account
 * itself. See `setup/auth.setup.ts` for why.
 *
 * node_modules/@buildone/swat-cli/knowledge/architecture_info/authentication.md
 */

/** Base URL of the running app (Caddy). Defaults to the local stack. */
export function getBaseURL(): string {
  return process.env.E2E_BASE_URL ?? 'http://localhost:8080';
}

/**
 * The dedicated test user's e-mail. Defaults to the account the auth server
 * seeds, which is also the one that exists on the shared auth servers.
 */
export function getE2eUserEmail(): string {
  return process.env.B1_E2E_USER_EMAIL ?? 'e2e_test@build.one';
}

/**
 * The dedicated test user's password, or null when the workspace has none.
 *
 * Absent is not misconfigured: the password is provisioned, never generated
 * (B1-1529), and only matches the account a **local** auth server seeds from
 * it, while `B1_AUTHENTICATION_SERVER_TYPE` defaults to `remote`, where the
 * suite authenticates with `B1_E2E_API_KEY` instead. The caller decides what to
 * do when this returns null.
 */
export function getE2eUserPassword(): string | null {
  return process.env.B1_E2E_USER_PASSWORD ?? null;
}
