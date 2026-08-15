/**
 * Make the Demo Factory runnable from the Studio screen in a workspace.
 *
 * The Studio spawns the pipeline inside the *app server's* container, and in a
 * workspace that container is a stock slim node image with the repository
 * bind-mounted: no browser, no ffmpeg, and — because the generated compose
 * file passes it `AUTH_URL` and little else — no workspace API key. A deployed
 * app has all three from `src/app-server-ts/Dockerfile`; a Codespace had none,
 * so `Run full demo` could only ever fail. This script is that Dockerfile
 * block, applied to a running dev stack. (The pipeline's own dependencies are
 * the app server's, installed by the root `yarn install`, so they need nothing
 * here.)
 *
 * It is idempotent and safe to re-run: every step checks before it acts.
 * `.devcontainer/scripts/provision-demo-factory.sh` runs it once the stack is
 * up (every Codespace start), and `yarn demo:provision` runs it by hand after
 * a stack restart, which takes the container's apt packages with it.
 *
 * One step writes into the repository rather than the container, because the
 * bind mount outlives it: the Playwright cache holding the bundled ffmpeg that
 * `recordVideo` needs (the system ffmpeg does not substitute for it —
 * Playwright looks for its own).
 */
import {execFile} from 'node:child_process';
import {existsSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {resolveApiKey} from '../src/lib/env.mjs';

const run = promisify(execFile);

const factoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(factoryRoot, '..', '..', '..');
const browsersCache = path.join(factoryRoot, '.cache', 'ms-playwright');

const log = (message) => console.log(`[demo-factory] ${message}`);

/** Never let provisioning break the caller; report and carry on. */
const attempt = async (label, action) => {
  try {
    return await action();
  } catch (error) {
    log(`${label} failed: ${error.message.split('\n')[0]}`);
    return null;
  }
};

const docker = async (args, options = {}) => (await run('docker', args, {maxBuffer: 64 * 1024 * 1024, ...options})).stdout.trim();

/**
 * The app server's container, once it exists.
 *
 * Discovered by its compose service label rather than by name: the project
 * prefix is the workspace's, not ours. Polled because this runs straight after
 * the stack is asked to start, and `docker compose up` returns before the
 * container is up.
 */
const findAppServer = async (timeoutMs = 180_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const id = await attempt('container lookup', () =>
      docker(['ps', '--filter', 'label=com.docker.compose.service=app_server_ts', '--format', '{{.ID}}']),
    );
    const first = (id || '').split('\n')[0].trim();
    if (first) return first;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
};

/** Where the container sees this repository, from its own bind mount. */
const containerRepoRoot = async (id) => {
  const mounts = await docker(['inspect', id, '--format', '{{range .Mounts}}{{.Source}}\t{{.Destination}}\n{{end}}']);
  for (const line of mounts.split('\n')) {
    const [source, destination] = line.split('\t');
    if (source && destination && repoRoot.startsWith(source)) return path.posix.join(destination, path.relative(source, repoRoot));
  }
  return null;
};

const containerHas = async (id, command) =>
  Boolean(await attempt(`checking ${command}`, () => docker(['exec', id, 'sh', '-c', `command -v ${command}`])));

/**
 * The URL the *container* reaches the web app on.
 *
 * Not `localhost:8080` — inside the app server that is the app server. The
 * proxy is another service on the compose network, so it is reached by service
 * name. Probed rather than assumed: a stack that names it differently should
 * leave B1_BASE_URL alone rather than record a wrong host.
 */
const reachableBaseUrl = async (id) => {
  for (const candidate of ['http://caddy:8080/', 'http://proxy:8080/']) {
    const ok = await attempt('probing the web app', () =>
      docker(['exec', id, 'node', '-e', `fetch(${JSON.stringify(candidate)}).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))`]),
    );
    if (ok !== null) return candidate;
  }
  return null;
};

/**
 * The workspace API key, resolved the way every other caller resolves it.
 *
 * A key belongs to one auth server, so it may be named for it
 * (`B1_USER_API_KEY__TRY_AUTH_TEST_BUILD_ONE`). Reuse the CLI's resolution
 * where it is installed; fall back to this project's copy of the same rule,
 * which is what the app server image has to use anyway.
 */
const workspaceApiKey = async () => {
  const helper = path.join(repoRoot, 'node_modules', '@buildone', 'swat-cli', 'scripts', 'utils', 'api-key.mjs');
  if (existsSync(helper)) {
    const {apiKeyFor} = await import(pathToFileURL(helper).href);
    return apiKeyFor(process.env.AUTH_URL, 'user', process.env)?.key || '';
  }
  return resolveApiKey()?.key || '';
};

// ---------------------------------------------------------------------------
// 1. Playwright's bundled ffmpeg, into the repository so it survives the
//    container. `recordVideo` refuses to start without it and will not use a
//    system ffmpeg in its place. ~2 MB, unlike a browser download.
// ---------------------------------------------------------------------------
if (existsSync(browsersCache)) {
  log('playwright ffmpeg already cached');
} else {
  log('downloading playwright ffmpeg…');
  await attempt('playwright install ffmpeg', () =>
    run('npx', ['playwright', 'install', 'ffmpeg'], {
      cwd: factoryRoot,
      env: {...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersCache},
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

// ---------------------------------------------------------------------------
// 2. Chromium and ffmpeg inside the app server's container. This is the one
//    step that does not survive the container being recreated, because the
//    image is not ours to change and the compose file that picks it is
//    generated. Re-running the script reinstalls them in about a minute.
// ---------------------------------------------------------------------------
const appServer = await findAppServer();
if (!appServer) {
  log('no app_server_ts container found — skipping the container steps (start the stack, then `yarn demo:provision`)');
  process.exit(0);
}

const hasChromium = await containerHas(appServer, 'chromium');
const hasFfmpeg = await containerHas(appServer, 'ffmpeg');
if (hasChromium && hasFfmpeg) {
  log('container already has chromium and ffmpeg');
} else {
  log('installing chromium and ffmpeg in the app server container (a few hundred MB, once per container)…');
  await attempt('apt-get', () =>
    docker([
      'exec',
      '-u',
      'root',
      '-e',
      'DEBIAN_FRONTEND=noninteractive',
      appServer,
      'sh',
      '-c',
      'apt-get update -qq && apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation fonts-noto-color-emoji',
    ]),
  );
}

// ---------------------------------------------------------------------------
// 3. Tell the app server what it now has.
//
//    These are the container's paths and the container's view of the network,
//    so they cannot go in the factory's `.env`, which the CLI also reads from a
//    workspace shell where every one of them would be wrong. The Studio's
//    server action reads this file as defaults beneath the Settings tab.
// ---------------------------------------------------------------------------
const containerRoot = (await containerRepoRoot(appServer)) || '/workspace';
const baseUrl = await reachableBaseUrl(appServer);
const apiKey = await workspaceApiKey();

const values = {
  ...(baseUrl ? {B1_BASE_URL: baseUrl} : {}),
  ...(apiKey ? {B1_USER_API_KEY: apiKey} : {}),
  PLAYWRIGHT_BROWSERS_PATH: path.posix.join(containerRoot, 'src', 'app-server-ts', 'demo-factory', '.cache', 'ms-playwright'),
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '/usr/bin/chromium',
  REMOTION_BROWSER_EXECUTABLE: '/usr/bin/chromium',
  FFMPEG_PATH: '/usr/bin/ffmpeg',
  FFPROBE_PATH: '/usr/bin/ffprobe',
  // One frame at a time. At 2 the Remotion compositor is SIGTERM-killed
  // mid-render on a default workspace, which is the same reason run-demo.mjs
  // defaults it — repeated here because the Studio spawns with this file's
  // values, not that script's defaults.
  REMOTION_CONCURRENCY: '1',
  REMOTION_OFFTHREADVIDEO_CACHE_MB: '512',
};

writeFileSync(
  path.join(factoryRoot, '.env.app-server'),
  [
    '# Written by tools/provision-workspace.mjs. Not for a shell: these are the',
    "# app server container's paths and its view of the compose network.",
    '# Read by the Demo Factory Studio server action as defaults beneath the',
    '# Settings tab. Delete it and the Studio falls back to its own environment.',
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    '',
  ].join('\n'),
  'utf8',
);

log(`wrote .env.app-server (base url ${baseUrl || 'unset'}, api key ${apiKey ? 'set' : 'unset'})`);
log('the Demo Factory Studio screen can now record and render');
