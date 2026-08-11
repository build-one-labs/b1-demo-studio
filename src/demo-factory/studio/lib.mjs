import path from 'node:path';

export const ALLOWED_ENV_KEYS = [
  'B1_BASE_URL',
  'B1_AUTH_STATE',
  'DEMO_HEADLESS',
  'REMOTION_CONCURRENCY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'ELEVENLABS_MODEL_ID',
  'ELEVENLABS_LANGUAGE_CODE',
  'VIBECODE_SOURCE_VIDEO',
  'DEMO_OUTPUT_DIR',
  'FFMPEG_PATH',
  'FFPROBE_PATH',
];

export const SECRET_ENV_KEYS = new Set(['ELEVENLABS_API_KEY']);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const assertSafeId = (value, label = 'id') => {
  if (!ID_PATTERN.test(value || '')) throw new Error(`Invalid ${label}`);
  return value;
};

export const safeChildPath = (root, ...segments) => {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...segments);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Path escapes the configured root');
  }
  return candidate;
};

export const publicSettings = (values) => Object.fromEntries(ALLOWED_ENV_KEYS.map((key) => [
  key,
  SECRET_ENV_KEYS.has(key)
    ? {configured: Boolean(values[key]), secret: true}
    : {value: values[key] || '', configured: Boolean(values[key]), secret: false},
]));

export const buildJobCommand = ({action, demoId, scenes = [], voice}) => {
  assertSafeId(demoId, 'demo id');
  const sceneIds = scenes.map((scene) => assertSafeId(scene, 'scene id'));
  if (voice && !['auto', 'elevenlabs', 'silent'].includes(voice)) throw new Error('Invalid voice provider');

  switch (action) {
    case 'validate':
      return {script: 'src/cli.mjs', args: ['validate', demoId], step: 'validate'};
    case 'prepare': {
      const args = ['prepare', demoId];
      if (voice && voice !== 'auto') args.push(`--voice=${voice}`);
      return {script: 'src/cli.mjs', args, step: 'prepare'};
    }
    case 'record': {
      const args = ['record', demoId];
      if (sceneIds.length) args.push(`--scenes=${sceneIds.join(',')}`);
      return {script: 'src/cli.mjs', args, step: 'record', needsFixture: true};
    }
    case 'render':
      return {script: 'src/cli.mjs', args: ['render', demoId], step: 'render'};
    case 'all':
      return {script: 'tools/run-demo.mjs', args: [demoId], step: 'all'};
    case 'source-import':
      return {script: 'tools/import-source-video.mjs', args: [demoId], step: 'record'};
    case 'source-render':
      return {script: 'tools/render-source-video.mjs', args: [demoId], step: 'render'};
    default:
      throw new Error('Unsupported job action');
  }
};
