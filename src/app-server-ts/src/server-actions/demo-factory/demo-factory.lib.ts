import path from 'node:path';

/**
 * Safety rails and job-command construction for the Demo Factory Studio.
 *
 * This mirrors `src/demo-factory/studio/lib.mjs`, which is the upstream
 * Studio's equivalent module. It is deliberately a port rather than an import:
 * the demo factory is a standalone npm project outside the yarn workspaces (so
 * React/Remotion never hoist into the Vue tree), and app-server-ts ships as its
 * own Docker image, which would not contain that tree. Keeping the rules here
 * means the server that actually spawns the pipeline owns them.
 *
 * Any change to the upstream list belongs here too — the values below are the
 * contract the Studio UI is written against.
 */

/** Runtime settings the Studio is allowed to read and write. Nothing else is exposed. */
export const ALLOWED_ENV_KEYS = [
  'B1_BASE_URL',
  'B1_AUTH_STATE',
  // `all` mints a fresh storage state before recording, and that exchange
  // authenticates with the workspace API key. The app server's container is not
  // given one — the compose file passes AUTH_URL and nothing else — so without
  // a way to supply it here the full run can only ever fail at its second step.
  'B1_USER_API_KEY',
  'DEMO_HEADLESS',
  'REMOTION_CONCURRENCY',
  'REMOTION_OFFTHREADVIDEO_CACHE_MB',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'ELEVENLABS_MODEL_ID',
  'ELEVENLABS_LANGUAGE_CODE',
  'DEMO_OUTPUT_DIR',
  'FFMPEG_PATH',
  'FFPROBE_PATH',
  'PLAYWRIGHT_BROWSERS_PATH',
  'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH',
  'REMOTION_BROWSER_EXECUTABLE'
] as const;

/** Never returned to the browser — only whether they are configured. */
export const SECRET_ENV_KEYS = new Set<string>(['ELEVENLABS_API_KEY', 'B1_USER_API_KEY']);

const ID_PATTERN = /^[\da-z][\da-z-]*$/;

export type JobAction = 'validate' | 'prepare' | 'record' | 'render' | 'all';

export interface JobCommand {
  script: string;
  args: string[];
  step: JobAction;
}

export const JOB_ACTIONS: readonly JobAction[] = ['validate', 'prepare', 'record', 'render', 'all'];

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
export const stageBlockedReason = (action: JobAction, host: HostCapabilities): string | null => {
  if (!host.hasFactory) return 'The demo factory is not installed on this host';
  if (!host.hasDependencies) {
    return 'The demo factory has no node_modules on this host — run `npm ci` in src/demo-factory';
  }
  if ((action === 'record' || action === 'all') && !host.canRecord) {
    return 'This host has no browser for Playwright to drive';
  }
  if ((action === 'render' || action === 'all') && !host.canRender) {
    return 'This host has no ffmpeg and ffprobe for the renderer to measure and compose clips with';
  }
  if (action === 'all' && !host.canAuthenticate) {
    return 'No workspace API key on this host, so the recording browser cannot be signed in — set B1_USER_API_KEY in Settings';
  }
  return null;
};

/** The blocked reason for every stage, for a screen that wants to explain itself. */
export const stageBlockedReasons = (host: HostCapabilities): Record<JobAction, string | null> =>
  Object.fromEntries(JOB_ACTIONS.map((action) => [action, stageBlockedReason(action, host)])) as Record<
    JobAction,
    string | null
  >;

export const assertSafeId = (value: string, label = 'id'): string => {
  if (!ID_PATTERN.test(value || '')) throw new Error(`Invalid ${label}`);
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
 * interpolation of user text into a command line. `source-import` and
 * `source-render` from upstream are omitted: their tools drive a pre-recorded
 * source video that this repository does not carry.
 */
export const buildJobCommand = ({
  action,
  demoId,
  scenes = [],
  voice
}: {
  action: JobAction;
  demoId: string;
  scenes?: string[];
  voice?: string;
}): JobCommand => {
  assertSafeId(demoId, 'demo id');
  const sceneIds = scenes.map((scene) => assertSafeId(scene, 'scene id'));
  if (voice && !['auto', 'elevenlabs', 'silent'].includes(voice)) throw new Error('Invalid voice provider');

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
      return { script: 'src/cli.mjs', args: ['render', demoId], step: 'render' };
    case 'all':
      return { script: 'tools/run-demo.mjs', args: [demoId], step: 'all' };
    default:
      throw new Error('Unsupported job action');
  }
};
