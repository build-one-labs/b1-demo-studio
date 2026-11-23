import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Safety rails and job-command construction for the Demo Factory Studio.
 *
 * The pipeline itself lives in `demo-factory/` next to `src/` (ESM, spawned as
 * a child process by the actions); these are the rules the server that spawns
 * it owns. The values below are the contract the Studio UI is written against.
 */

/** Runtime settings the Studio is allowed to read and write. Nothing else is exposed. */
export const ALLOWED_ENV_KEYS = [
  'B1_BASE_URL',
  'B1_AUTH_STATE',
  // `all` mints a fresh storage state before recording, and that exchange
  // authenticates with the user API key — as does the recording itself, by
  // header, on a host where the mint is unavailable. A deployed container has
  // one only if the compose file passes it, so this stays writable from
  // Settings for the host where nobody did.
  'B1_USER_API_KEY',
  'DEMO_HEADLESS',
  'REMOTION_CONCURRENCY',
  'REMOTION_OFFTHREADVIDEO_CACHE_MB',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'ELEVENLABS_MODEL_ID',
  'ELEVENLABS_LANGUAGE_CODE',
  'DEMO_OUTPUT_DIR',
  // Where the content-addressed narration cache lives. On a deployment both
  // this and DEMO_OUTPUT_DIR point into a persistent volume, so redeploys
  // neither lose the runs nor re-buy every line of voice-over.
  'DEMO_CACHE_DIR',
  'FFMPEG_PATH',
  'FFPROBE_PATH',
  'PLAYWRIGHT_BROWSERS_PATH',
  'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH',
  'REMOTION_BROWSER_EXECUTABLE'
] as const;

/** Never returned to the browser — only whether they are configured. */
export const SECRET_ENV_KEYS = new Set<string>(['ELEVENLABS_API_KEY', 'B1_USER_API_KEY']);

/**
 * The environment-variable fragment naming one auth server, e.g.
 * `try-auth.test.build.one` → `TRY_AUTH_TEST_BUILD_ONE`.
 *
 * The same rule as the CLI's `scripts/utils/api-key.mjs`, the shell's
 * `b1_auth_host_slug` and the factory's `src/lib/env.mjs`. A port for the same
 * reason as everything else in this file: swat-cli is a development dependency
 * and this server ships as an image that does not contain it.
 */
export const authHostSlug = (url: string | undefined): string | null => {
  if (!url) return null;
  const host = url
    .replace(/^[^:]+:\/\//, '')
    .replace(/[/?].*$/, '')
    .replace(/^.*@/, '')
    .replace(/:\d+$/, '');
  if (host === '') return null;
  const slug = host.replace(/[.-]/g, '_').toUpperCase();
  return /^[\dA-Z_]+$/.test(slug) ? slug : null;
};

/**
 * The user API key for one auth server, scoped name first.
 *
 * Keys are issued per auth server and named for it
 * (`B1_USER_API_KEY__TRY_AUTH_TEST_BUILD_ONE`); the unqualified name is a
 * fallback that a workspace no longer sets, kept because it is what the
 * Settings tab writes and what this server hands the pipeline it spawns.
 *
 * Scoped to the given `authUrl` deliberately: a host holding a key for some
 * other auth server cannot sign this recording in, and reporting `canAuthenticate`
 * for it would enable the button and fail at the exchange.
 */
export const resolveApiKey = (
  env: Record<string, string | undefined>,
  authUrl: string | undefined
): { name: string; key: string } | null => {
  const slug = authHostSlug(authUrl);
  const names = slug ? [`B1_USER_API_KEY__${slug}`, 'B1_USER_API_KEY'] : ['B1_USER_API_KEY'];
  for (const name of names) {
    const key = env[name];
    if (key) return { name, key };
  }
  return null;
};

/**
 * The pipeline: `demo-factory/` beside this server's `src/`, resolved from the
 * caller's directory so it is the same directory from `src/` (dev, ts) and
 * `dist/` (built). The env var exists for deployments that mount it elsewhere.
 *
 * Every part of the server that touches the factory resolves it through here —
 * the actions, the media controller and the data-source services — because a
 * host where two of them disagree is a host where the Studio lists a run the
 * media controller cannot find.
 */
export const projectRootFrom = (dirname: string): string =>
  process.env.DEMO_FACTORY_ROOT || path.resolve(dirname, '..', '..', '..', 'demo-factory');

/**
 * What `tools/provision-workspace.mjs` left for this server in
 * `demo-factory/.env.app-server`, restricted to the keys the Studio may read.
 *
 * The app server sees the pipeline's host differently from a workspace shell:
 * its Chromium is a container path, the web app to record is `caddy:8080` on
 * the compose network, and its API key arrives here rather than in its
 * environment. Those values cannot live in the factory's own `.env`, which the
 * CLI also reads from a shell where all of them would be wrong.
 *
 * Read on every call rather than once: on a fresh Codespace the provisioner
 * runs after the stack is up, minutes after this server first booted, so a
 * cache would be the only thing making the timing matter. A missing file is a
 * normal state — a deployed image sets the same variables in its environment.
 */
export const readProvisionedEnv = async (projectRoot: string): Promise<Record<string, string>> => {
  const allowed = new Set<string>(ALLOWED_ENV_KEYS);
  const values: Record<string, string> = {};
  try {
    // The path is the fixed factory root plus a literal name — nothing from a
    // caller reaches it, which is what the rule guards against.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const text = await readFile(path.join(projectRoot, '.env.app-server'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      const separator = trimmed.indexOf('=');
      if (!trimmed || trimmed.startsWith('#') || separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      if (allowed.has(key))
        values[key] = trimmed
          .slice(separator + 1)
          .trim()
          .replace(/^(["'])(.*)\1$/, '$2');
    }
  } catch {
    // No provisioning on this host.
  }
  return values;
};

/**
 * The user API key this server may act with when no request is in flight —
 * the environment's scoped key first, else the one the provisioner wrote.
 *
 * A *user* key deliberately: the framework's guard resolves `x-api-key` to the
 * user who owns it and refuses an organization key, which "resolves to no
 * user" — a request has to run as somebody.
 */
export const serviceApiKey = async (projectRoot: string): Promise<string> =>
  resolveApiKey(process.env, process.env.AUTH_URL)?.key ||
  (await readProvisionedEnv(projectRoot)).B1_USER_API_KEY ||
  '';

/**
 * Who may mutate the factory (start jobs, save or import demos, mint auth
 * state), as a comma-separated list of account e-mails in the environment.
 *
 * Unset means open — the behaviour every existing workspace has, where the
 * Studio is reachable only by people who can reach the workspace anyway. On a
 * deployed stack the variable is what separates "may watch videos" from "may
 * re-record them", until the platform's Melange checks take over that job.
 */
export const OPERATORS_ENV = 'DEMO_FACTORY_OPERATORS';

export const assertOperator = (userEmail: string | undefined, env = process.env): void => {
  const allowed = (env[OPERATORS_ENV] || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return;
  if (!userEmail || !allowed.includes(userEmail.toLowerCase())) {
    throw new Error(`Not allowed — ${OPERATORS_ENV} does not list this account`);
  }
};

const ID_PATTERN = /^[\da-z][\da-z-]*$/;

/** The pipeline stages a demo goes through — one button each on the screen. */
export type StageAction = 'validate' | 'prepare' | 'record' | 'render' | 'all';

/**
 * Everything a job can be: the stages, plus `analyze`, which turns an uploaded
 * screen recording into a demo and therefore runs before the demo exists.
 */
export type JobAction = StageAction | 'analyze' | 'convert';

export interface JobCommand {
  script: string;
  args: string[];
  step: JobAction;
}

export const JOB_ACTIONS: readonly StageAction[] = ['validate', 'prepare', 'record', 'render', 'all'];

/** What the host running the pipeline can actually do. */
export interface HostCapabilities {
  hasFactory: boolean;
  hasDependencies: boolean;
  canRecord: boolean;
  canRender: boolean;
  canAuthenticate: boolean;
}

/**
 * Why a stage cannot run here, or null when it can.
 *
 * One function rather than a rule in the server and a matching rule in the
 * screen: the two drifting is how `all` came to be the single control that
 * ignored the capability check, spawning a pipeline whose first stage the
 * server already knew would not resolve its imports.
 *
 * `all` is every stage in one process (`tools/run-demo.mjs`), so it needs
 * everything the individual stages need — plus a way to sign the recording
 * browser in, which is the one requirement no single stage has.
 */
/**
 * `filmsInBrowser` is false for a demo cut entirely from an uploaded screen
 * recording: its record stage is ffmpeg cutting clips, so it needs no browser
 * and nobody to sign in — but it does need ffmpeg, as `analyze` does.
 */
export const stageBlockedReason = (
  action: JobAction,
  host: HostCapabilities,
  { filmsInBrowser = true, hasDemoUser = false }: { filmsInBrowser?: boolean; hasDemoUser?: boolean } = {}
): string | null => {
  if (!host.hasFactory) return 'The demo factory is not installed on this host';
  if (!host.hasDependencies) {
    return 'The Demo Factory dependencies are not installed on this host — run `yarn install` at the repository root';
  }
  if (
    (action === 'record' || action === 'all' || action === 'convert') &&
    (filmsInBrowser || action === 'convert') &&
    !host.canRecord
  ) {
    return 'This host has no browser for Playwright to drive';
  }
  const needsFfmpeg =
    action === 'render' ||
    action === 'all' ||
    action === 'analyze' ||
    action === 'convert' ||
    (action === 'record' && !filmsInBrowser);
  if (needsFfmpeg && !host.canRender) {
    return action === 'analyze' || action === 'record' || action === 'convert'
      ? 'This host has no ffmpeg and ffprobe to analyze and cut the uploaded video with'
      : 'This host has no ffmpeg and ffprobe for the renderer to measure and compose clips with';
  }
  // A demo with its own demo user brings its key; only the host's is checked here.
  if (((action === 'all' && filmsInBrowser) || action === 'convert') && !hasDemoUser && !host.canAuthenticate) {
    return 'No user API key for this auth server on this host, so the recording browser cannot be signed in — set B1_USER_API_KEY__<AUTH HOST> on the container, or paste a key into Settings';
  }
  return null;
};

/**
 * The blocked reason for every stage, for a screen that wants to explain itself.
 *
 * This is the host's verdict, without a demo, so it leaves out the one rule
 * that depends on the demo: a demo with a demo user signs in with that user's
 * key, and the host's own key does not matter. Counting it here blocked Run
 * full demo in the Studio on every host without a key of its own, before the
 * demo's settings were even saved; `start-job` checks it per demo instead.
 */
export const stageBlockedReasons = (host: HostCapabilities): Record<StageAction, string | null> =>
  Object.fromEntries(
    JOB_ACTIONS.map((action) => [action, stageBlockedReason(action, host, { hasDemoUser: true })])
  ) as Record<StageAction, string | null>;

/** An upload's id: a timestamp and a random suffix, lowercase, safe as a directory name. */
export const UPLOAD_ID_PATTERN = /^[\da-z][\da-z-]*$/;

/** What may be uploaded as a screen recording. */
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);

/** Large enough for an hour of 1080p screen recording, small enough to stop a mistake. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * The largest slice of a chunked upload. Below the ~15 MB request limit of
 * GitHub Codespaces' port forwarding, with room for any proxy that allows 10 MB.
 */
export const MAX_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export const newUploadId = (now = new Date()): string =>
  `${now.toISOString().replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Directories of the output root that are not demos: the uploaded recordings
 * and the job transcripts. Never an id, so no media route or run listing can
 * reach them under a demo's name.
 */
export const RESERVED_OUTPUT_DIRS: ReadonlySet<string> = new Set(['uploads', 'logs']);

export const assertSafeId = (value: string, label = 'id'): string => {
  if (!ID_PATTERN.test(value || '') || RESERVED_OUTPUT_DIRS.has(value)) throw new Error(`Invalid ${label}`);
  return value;
};

/**
 * Resolve `segments` under `root`, refusing anything that escapes it.
 * Demo ids and run ids reach this from the browser, so `../` must not work.
 */
export const safeChildPath = (root: string, ...segments: string[]): string => {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Path escapes the configured root');
  }
  return candidate;
};

export interface PublicSetting {
  value?: string;
  configured: boolean;
  secret: boolean;
}

export const publicSettings = (values: Record<string, string>): Record<string, PublicSetting> =>
  Object.fromEntries(
    ALLOWED_ENV_KEYS.map((key) => [
      key,
      SECRET_ENV_KEYS.has(key)
        ? { configured: Boolean(values[key]), secret: true }
        : { value: values[key] || '', configured: Boolean(values[key]), secret: false }
    ])
  );

/**
 * The only commands this service will ever spawn.
 *
 * Everything is an explicit argv against a fixed script — no shell, no
 * interpolation of user text into a command line. The one free text that
 * reaches an argv, an analyzed demo's title, travels as a single `--title=`
 * element of it, which no shell ever splits. Upstream's `source-import` and
 * `source-render` tools are replaced by `analyze` plus clip scenes, which the
 * ordinary record and render stages handle.
 */
export const buildJobCommand = ({
  action,
  demoId,
  scenes = [],
  voice,
  runId,
  uploadId,
  title,
  language
}: {
  action: JobAction;
  demoId: string;
  scenes?: string[];
  voice?: string;
  runId?: string;
  uploadId?: string;
  title?: string;
  language?: string;
}): JobCommand => {
  assertSafeId(demoId, 'demo id');
  const sceneIds = scenes.map((scene) => assertSafeId(scene, 'scene id'));
  if (voice && !['auto', 'elevenlabs', 'silent'].includes(voice)) throw new Error('Invalid voice provider');
  if (runId && (action !== 'render' || !/^[\dA-Za-z][\w-]*$/.test(runId))) {
    throw new Error('Invalid render run id');
  }

  switch (action) {
    case 'validate':
      return { script: 'src/cli.mjs', args: ['validate', demoId], step: 'validate' };
    case 'prepare': {
      const args = ['prepare', demoId];
      if (voice && voice !== 'auto') args.push(`--voice=${voice}`);
      return { script: 'src/cli.mjs', args, step: 'prepare' };
    }
    case 'record': {
      const args = ['record', demoId];
      if (sceneIds.length > 0) args.push(`--scenes=${sceneIds.join(',')}`);
      return { script: 'src/cli.mjs', args, step: 'record' };
    }
    case 'render':
      return { script: 'src/cli.mjs', args: ['render', demoId, ...(runId ? [`--run=${runId}`] : [])], step: 'render' };
    case 'all':
      return { script: 'tools/run-demo.mjs', args: [demoId], step: 'all' };
    case 'convert':
      // Through run-demo.mjs for its sign-in: the conversion's trial runs film.
      return { script: 'tools/run-demo.mjs', args: [demoId, '--stages=convert'], step: 'convert' };
    case 'analyze': {
      if (!uploadId || !UPLOAD_ID_PATTERN.test(uploadId)) throw new Error('Invalid upload id');
      if (language && !/^[a-z]{2,3}$/.test(language)) throw new Error('Invalid language code');
      const args = ['analyze', demoId, `--upload=${uploadId}`];
      const cleanTitle = (title ?? '')
        .replace(/[\n\r]+/g, ' ')
        .trim()
        .slice(0, 200);
      if (cleanTitle) args.push(`--title=${cleanTitle}`);
      if (language) args.push(`--language=${language}`);
      return { script: 'src/cli.mjs', args, step: 'analyze' };
    }
    default:
      throw new Error('Unsupported job action');
  }
};
