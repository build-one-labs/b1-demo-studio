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
export const SECRET_ENV_KEYS = new Set<string>(['ELEVENLABS_API_KEY']);

const ID_PATTERN = /^[\da-z][\da-z-]*$/;

export type JobAction = 'validate' | 'prepare' | 'record' | 'render' | 'all';

export interface JobCommand {
  script: string;
  args: string[];
  step: JobAction;
}

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
