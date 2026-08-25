/**
 * Typed accessors for the environment configuration the E2E suite needs.
 *
 * The suite authenticates the way the rest of the workspace does — with the
 * workspace API key — and keeps the system-user password only as a fallback
 * for a local-auth workspace. See `setup/auth.setup.ts` for why.
 *
 * node_modules/@buildone/swat-cli/knowledge/architecture_info/authentication.md
 */

/** Base URL of the running app (Caddy). Defaults to the local stack. */
export function getBaseURL(): string {
  return process.env.E2E_BASE_URL ?? 'http://localhost:8080';
}

/** System-user email. Defaults to the framework default `system@build.one`. */
export function getSystemUserEmail(): string {
  return process.env.B1_SYSTEM_USER_EMAIL ?? 'system@build.one';
}

/**
 * System-user password, or null when the workspace has none.
 *
 * This used to throw. It no longer does, because "unset" stopped meaning
 * "misconfigured": the password is generated per workspace into
 * .b1/env/.env.local, and against the default remote auth server it matches no
 * user at all — so a workspace where it is absent, or present and useless, is
 * the normal case. The API key is what authenticates the suite now; the caller
 * decides what to do when this returns null.
 */
export function getSystemUserPassword(): string | null {
  return process.env.B1_SYSTEM_USER_PASSWORD ?? null;
}
