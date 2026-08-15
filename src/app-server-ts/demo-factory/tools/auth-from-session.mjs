/**
 * Builds the Playwright storage state from a session token you already hold.
 *
 * The two supported logins are both unavailable in some workspaces: the API-key
 * handoff (`b1-auth-state.mjs`) needs an auth server that implements the
 * `x-api-key` branch of /api/auth/mcp/handoff/issue, and the interactive
 * capture (`capture-auth.mjs`) launches a HEADED browser, which a codespace has
 * no display for. This is the third way in: if you are signed in to the app in
 * your own browser, that session is already the thing the recorder needs.
 *
 * The token travels under two cookie names — `b1.session_token` and, over
 * HTTPS, `__Secure-b1.session_token`. The framework's own SWAT client sends
 * both with the same value (app-server-tslib swat.service.js), and the
 * handoff's SSO endpoint does the same re-homing when it adapts a cookie to a
 * local origin. This writes both, so one state file works against
 * http://localhost:8080 and against a deployed HTTPS app.
 *
 * Usage:
 *   node tools/auth-from-session.mjs <session-token>
 *   B1_SESSION_TOKEN=<session-token> node tools/auth-from-session.mjs
 *
 * Get the token from the browser you are signed in with:
 *   DevTools > Application > Cookies > b1.session_token (or __Secure-b1.session_token)
 *
 * The token IS the session. Treat the output as a secret; it is gitignored.
 */
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadDotEnv} from '../src/lib/env.mjs';

await loadDotEnv();

const token = (process.argv[2] || process.env.B1_SESSION_TOKEN || '').trim();
if (!token) throw new Error('Pass the session token as an argument or set B1_SESSION_TOKEN. See the header of this file for where to find it.');

const baseUrl = process.env.B1_BASE_URL;
if (!baseUrl) throw new Error('Set B1_BASE_URL (or put it in src/app-server-ts/demo-factory/.env) so the cookie is written for the right host');

const target = new URL(baseUrl);
const secure = target.protocol === 'https:';
// A year out: the recorder only ever reads this file, and an expiry in the past
// makes Playwright drop the cookie silently rather than fail loudly.
const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

const cookie = (name) => ({
  name,
  value: token,
  domain: target.hostname,
  path: '/',
  expires,
  httpOnly: true,
  secure,
  sameSite: 'Lax',
});

// The __Secure- prefix is only legal on a secure origin; sending it over plain
// http is what the SSO endpoint strips, so do not write it for localhost.
const cookies = secure ? [cookie('b1.session_token'), cookie('__Secure-b1.session_token')] : [cookie('b1.session_token')];

const authFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'playwright', '.auth', 'b1-demo-user.json');
await mkdir(path.dirname(authFile), {recursive: true});
await writeFile(authFile, `${JSON.stringify({cookies, origins: []}, null, 2)}\n`, 'utf8');

console.log(`Auth state written to ${authFile}`);
console.log(`  host    : ${target.hostname}${secure ? ' (https — both cookie names written)' : ' (http — plain cookie name only)'}`);
console.log(`  next    : export B1_AUTH_STATE=${authFile}`);
console.log('This file is a live session. It is gitignored — do not commit or share it.');
