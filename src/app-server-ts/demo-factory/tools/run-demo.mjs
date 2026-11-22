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
import {loadDemo} from '../src/lib/files.mjs';
import {isClipScene, sceneBaseUrl} from '../src/schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoId = process.argv[2] || 'sales-tour-planning';
// `--stages=convert` runs the conversion of a video demo instead of the
// production stages — the same sign-in first, because its trial run films.
const stagesFlag = process.argv.find((arg) => arg.startsWith('--stages='));
const stages = stagesFlag ? stagesFlag.slice('--stages='.length).split(',') : ['prepare', 'record', 'render'];
const baseUrl = process.env.B1_BASE_URL || 'http://localhost:8080/';
const authState = process.env.B1_AUTH_STATE || path.join(root, 'playwright', '.auth', 'b1-demo-user.json');

// Concurrency 1 unless overridden: at 2, the Remotion compositor gets
// SIGTERM-killed mid-render on a default 8 GB workspace (observed at ~frame
// 1500 of a 1080p run) — the upstream README's Codespaces warning, made default.
const concurrency = process.env.REMOTION_CONCURRENCY || '1';
const offthreadCacheMb = process.env.REMOTION_OFFTHREADVIDEO_CACHE_MB || '512';

const run = (args, extraEnv = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      B1_BASE_URL: baseUrl,
      B1_AUTH_STATE: authState,
      REMOTION_CONCURRENCY: concurrency,
      REMOTION_OFFTHREADVIDEO_CACHE_MB: offthreadCacheMb,
      ...extraEnv,
    },
    stdio: 'inherit',
  });
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited with ${code}`)));
  child.once('error', reject);
});

await run(['src/cli.mjs', 'validate', demoId]);

// A demo cut from the author's own screen recording films nothing, so there
// is no browser to sign in.
const {demo} = await loadDemo(demoId);
const converting = stages.includes('convert') || stages.includes('inspect');
const filmsInBrowser = converting || demo.scenes.some((scene) => !isClipScene(scene));
// Every application a take opens — the demo's own and any a scene names (see
// sceneBaseUrl): the sign-in below needs a session for each.
// An inspection opens only these too (inspect.mjs refuses any other origin).
const appUrls = [...new Set([{}, ...demo.scenes].map((scene) => new URL(sceneBaseUrl(demo, scene, {...process.env, B1_BASE_URL: baseUrl})).origin))];

// A minted storage state is the best take — a real session cookie, exactly
// what a customer's browser carries. It is not always obtainable: the mint
// needs an auth server with the x-api-key handoff branch, and an older
// deployment answers 401 (see browser-session.mjs). That is not the end of the
// run, because record.mjs has a second way in — it authenticates every request
// with the API key header when no storage state exists. So the mint is
// attempted, and a failure is reported rather than fatal, as long as the take
// can still be signed in some other way. With neither, the recording would be
// of the sign-in page, which is worth stopping for.
if (!filmsInBrowser) {
  console.log('Every scene is a clip of the source video — no browser sign-in needed.');
} else if (existsSync(authState)) {
  console.log(`Reusing the auth state at ${authState}; it is refreshed below if this workspace can mint one.`);
}
if (filmsInBrowser) {
  try {
    await run(['tools/b1-auth-state.mjs'], {B1_BASE_URLS: appUrls.join(',')});
  } catch (error) {
    if (!existsSync(authState) && !resolveApiKey()) {
      throw new Error(
        `Cannot sign the recording in: ${error.message}\n` +
          'This host has no auth state and no user API key. Capture one interactively with ' +
          '`yarn demo:auth:b1`, or set the key for this auth server — ' +
          `B1_USER_API_KEY__<AUTH HOST> (${process.env.AUTH_URL || 'AUTH_URL unset'}) or B1_USER_API_KEY — ` +
          'so the recording can authenticate by header.',
      );
    }
    console.warn(`Could not mint a fresh auth state (${error.message}).`);
    console.warn(existsSync(authState) ? 'Recording with the stored state.' : 'Recording with the API key header.');
  }
}

// Flags for a stage (`--request=`, `--out=` of inspect) pass through to the CLI.
const passThrough = process.argv.slice(3).filter((arg) => /^--(request|out|scenes)=/.test(arg));
for (const stage of stages) {
  if (!['convert', 'inspect', 'prepare', 'record', 'render'].includes(stage)) throw new Error(`Unknown stage ${stage}`);
  await run(['src/cli.mjs', stage, demoId, ...passThrough]);
}
