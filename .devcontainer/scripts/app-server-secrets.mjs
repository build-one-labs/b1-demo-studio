/**
 * Hand the app server the workspace secrets its containers never receive.
 *
 * A Codespace secret is set on the *devcontainer*: it is in the shell's
 * environment, in `b1` CLI calls, in everything that runs at
 * /workspaces/<repo>. The application, though, runs in compose services beside
 * it, and the compose file that starts them is generated into `.deploy/` — not
 * ours to edit, and gitignored, so an `environment:` entry added by hand is
 * gone at the next generation. It forwards what the platform needs (AUTH_URL,
 * the database URLs, the data folders) and nothing a product's own code might
 * read. So `SALESFORCE_CLIENT_ID` is set in the workspace and undefined in the
 * process that actually calls Salesforce, and the screen reads
 * "credentials are not configured" while the shell three feet away has them.
 *
 * The app server's `ConfigModule.forRoot()` loads a `.env` from its working
 * directory, which is the bind-mounted `src/app-server-ts`. That is the seam:
 * write the secrets there and the running server has them, with no change to a
 * generated file and nothing to re-apply after the stack is regenerated.
 * @nestjs/config never overwrites a variable the container already has, so the
 * compose file stays authoritative for everything it does set.
 *
 * Run by the Codespace startup orchestrator, and by hand after adding a secret:
 *
 *     node .devcontainer/scripts/app-server-secrets.mjs
 */
import {execFile} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile);

/**
 * The variables to forward. An allowlist, and deliberately a short one.
 *
 * Only secrets belonging to the *application's own* integrations go here —
 * credentials for a third party the product's code calls. Never anything
 * describing the workspace's own topology: the devcontainer's
 * `APP_DATABASE_URL`, `AUTH_URL` or `B1_BASE_URL` name hosts and ports as seen
 * from outside the compose network, and inside it every one of them is wrong.
 * The container's own values are the correct ones and must win.
 *
 * Add a line here when a connector starts reading a new secret.
 */
const FORWARDED = ['SALESFORCE_INSTANCE_URL', 'SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET'];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = path.join(repoRoot, 'src', 'app-server-ts', '.env');

const log = (message) => console.log(`[app-server-secrets] ${message}`);

/** Parse an existing .env into ordered entries, so foreign keys survive a rewrite. */
const parse = (text) => {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf('=');
    if (!trimmed || trimmed.startsWith('#') || separator < 1) continue;
    entries.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1));
  }
  return entries;
};

const existing = existsSync(envFile) ? parse(readFileSync(envFile, 'utf8')) : new Map();
const before = JSON.stringify([...existing]);

const forwarded = [];
const missing = [];
for (const key of FORWARDED) {
  const value = process.env[key];
  if (value) {
    existing.set(key, value);
    forwarded.push(key);
  } else {
    missing.push(key);
  }
}

if (missing.length > 0) {
  log(`not set in this workspace, so not forwarded: ${missing.join(', ')}`);
}

if (forwarded.length === 0) {
  log('nothing to forward');
  process.exit(0);
}

if (JSON.stringify([...existing]) === before) {
  log(`already current: ${forwarded.join(', ')}`);
  process.exit(0);
}

writeFileSync(
  envFile,
  [
    '# Written by .devcontainer/scripts/app-server-secrets.mjs.',
    '# Workspace secrets the generated compose file does not pass to this',
    '# container, loaded by ConfigModule.forRoot(). Gitignored; edit the',
    "# script's allowlist rather than this file, which is rewritten.",
    ...[...existing].map(([key, value]) => `${key}=${value}`),
    '',
  ].join('\n'),
  'utf8',
);
log(`wrote src/app-server-ts/.env with ${forwarded.join(', ')}`);

// The server reads .env once, at startup, so a change means a restart. Only
// reached when a value actually changed, which on a fresh Codespace is once —
// and it is a restart, not a recreate, so anything installed in the container
// survives it.
const container = await run('docker', [
  'ps',
  '--filter',
  'label=com.docker.compose.service=app_server_ts',
  '--format',
  '{{.ID}}',
])
  .then(({stdout}) => stdout.trim().split('\n')[0].trim())
  .catch(() => '');

if (!container) {
  log('app server not running; it will read the new values when it starts');
  process.exit(0);
}

log('restarting the app server so it picks them up…');
await run('docker', ['restart', container], {maxBuffer: 8 * 1024 * 1024}).then(
  () => log('app server restarted'),
  (error) => log(`could not restart the app server (${error.message.split('\n')[0]}); restart it to apply`),
);
