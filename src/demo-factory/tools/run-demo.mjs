/**
 * One-command pipeline run against this workspace's web app.
 *
 * Differs from the upstream b1-demo-factory runner in two workspace-shaped
 * ways: the default target is the local web app rather than a fixture server
 * (the fixture is upstream's contract test and is not vendored here), and the
 * auth state is minted fresh from the workspace API key before recording —
 * the handoff code behind it lives 60 seconds, so a stored state is exactly
 * the thing that rots between runs.
 */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveApiKey} from '../src/lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoId = process.argv[2] || 'sales-tour-planning';
const baseUrl = process.env.B1_BASE_URL || 'http://localhost:8080/';
const authState = process.env.B1_AUTH_STATE || path.join(root, 'playwright', '.auth', 'b1-demo-user.json');

// Concurrency 1 unless overridden: at 2, the Remotion compositor gets
// SIGTERM-killed mid-render on a default 8 GB workspace (observed at ~frame
// 1500 of a 1080p run) — the upstream README's Codespaces warning, made default.
const concurrency = process.env.REMOTION_CONCURRENCY || '1';
const offthreadCacheMb = process.env.REMOTION_OFFTHREADVIDEO_CACHE_MB || '512';

const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      B1_BASE_URL: baseUrl,
      B1_AUTH_STATE: authState,
      REMOTION_CONCURRENCY: concurrency,
      REMOTION_OFFTHREADVIDEO_CACHE_MB: offthreadCacheMb,
    },
    stdio: 'inherit',
  });
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited with ${code}`)));
  child.once('error', reject);
});

await run(['src/cli.mjs', 'validate', demoId]);

// A minted storage state is the best take — a real session cookie, exactly
// what a customer's browser carries. It is not always obtainable: the mint
// needs an auth server with the x-api-key handoff branch, and an older
// deployment answers 401 (see browser-session.mjs). That is not the end of the
// run, because record.mjs has a second way in — it authenticates every request
// with the API key header when no storage state exists. So the mint is
// attempted, and a failure is reported rather than fatal, as long as the take
// can still be signed in some other way. With neither, the recording would be
// of the sign-in page, which is worth stopping for.
if (existsSync(authState)) {
  console.log(`Reusing the auth state at ${authState}; it is refreshed below if this workspace can mint one.`);
}
try {
  await run(['tools/b1-auth-state.mjs']);
} catch (error) {
  if (!existsSync(authState) && !resolveApiKey()) {
    throw new Error(
      `Cannot sign the recording in: ${error.message}\n` +
        'This host has no auth state and no user API key. Capture one interactively with ' +
        '`npm run auth:b1`, or set the key for this auth server — ' +
        `B1_USER_API_KEY__<AUTH HOST> (${process.env.AUTH_URL || 'AUTH_URL unset'}) or B1_USER_API_KEY — ` +
        'so the recording can authenticate by header.',
    );
  }
  console.warn(`Could not mint a fresh auth state (${error.message}).`);
  console.warn(existsSync(authState) ? 'Recording with the stored state.' : 'Recording with the API key header.');
}

await run(['src/cli.mjs', 'prepare', demoId]);
await run(['src/cli.mjs', 'record', demoId]);
await run(['src/cli.mjs', 'render', demoId]);
