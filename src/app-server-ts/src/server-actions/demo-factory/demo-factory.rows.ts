import { createHash } from 'node:crypto';

/**
 * The row shapes of the Demo Factory's data sources, and the mapping between a
 * demo document and the rows that hold it.
 *
 * One module rather than a shape per caller: the Studio screen reads these rows
 * and the server writes them, and a demo document survives a round trip through
 * them only if both sides agree on every field name. The zod schema in
 * `demo-factory/src/schema.mjs` stays the authority on what a *document* is —
 * this file only takes it apart and puts it back together, which is why
 * `rowsToDemo` is deliberately dumb: it reassembles, it never repairs.
 *
 * A clob payload is arbitrary JSON per row, so a column holding a nested object
 * (`settings`, `actions`, `assertions`, `cues`) stores the object itself. The
 * `dataType: "string"` those fields carry in the blueprint is field metadata for
 * grids and forms, which none of these data sources render.
 */

/** The data source names, so a typo is a compile error rather than a 404. */
export const DSO = {
  demo: 'DemoFactoryDemoDSO',
  scene: 'DemoFactorySceneDSO',
  run: 'DemoFactoryRunDSO',
  runScene: 'DemoFactoryRunSceneDSO',
  narration: 'DemoFactoryNarrationDSO',
  caption: 'DemoFactoryCaptionDSO',
  setting: 'DemoFactorySettingDSO',
  stage: 'DemoFactoryStageDSO',
  host: 'DemoFactoryHostDSO',
  job: 'DemoFactoryJobDSO'
} as const;

export interface DemoRow {
  id: string;
  title: string;
  description: string;
  schemaVersion: number;
  settings: Record<string, unknown>;
  sceneCount: number;
  invalid: boolean;
  invalidReason: string;
  /** Hash of the `demo.yaml` this row was last seeded from — see the seed service. */
  sourceHash: string;
  /** The file on disk has moved on, but this row was edited in the Studio. */
  driftedFromFile: boolean;
  /** Null until the Studio writes the row; that is what makes a reseed safe. */
  updatedAt: string | null;
}

export interface SceneRow {
  id: string;
  demoId: string;
  sceneId: string;
  sequence: number;
  title: string;
  route: string;
  narration: string;
  actions: unknown[];
  assertions: unknown[];
}

export interface RunRow {
  runId: string;
  demoId: string;
  createdAt: string;
  provider: string | null;
  sceneCount: number;
  recordedScenes: number;
  durationMs: number | null;
  hasVideo: boolean;
  demoHash: string;
  baseUrl: string;
  recordedAt: string | null;
  videoUrl: string;
  srtUrl: string;
}

export interface RunSceneRow {
  id: string;
  runId: string;
  demoId: string;
  sceneId: string;
  sequence: number;
  title: string;
  durationMs: number | null;
  hasClip: boolean;
  narrationDurationMs: number | null;
  recordedDurationMs: number | null;
  narrationOffsetMs: number | null;
  clipFile: string;
  cues: Record<string, number>;
}

export interface NarrationRow {
  id: string;
  runId: string;
  demoId: string;
  sceneId: string;
  sequence: number;
  provider: string;
  cacheKey: string;
  text: string;
  durationMs: number | null;
  cues: Record<string, number>;
  audioUrl: string;
  alignmentUrl: string;
}

export interface CaptionRow {
  id: string;
  runId: string;
  demoId: string;
  sceneId: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface SettingRow {
  key: string;
  label: string;
  value: string;
  configured: boolean;
  secret: boolean;
  source: 'operator' | 'provisioned' | 'environment' | 'unset';
  sequence: number;
}

export interface StageRow {
  id: string;
  label: string;
  hint: string;
  sequence: number;
  allowed: boolean;
  blockedReason: string;
}

export interface HostRow {
  id: 'host';
  pipelineRoot: string;
  hasFactory: boolean;
  hasDependencies: boolean;
  canRecord: boolean;
  canRender: boolean;
  canAuthenticate: boolean;
}

export interface JobRow {
  id: string;
  action: string | null;
  demoId: string | null;
  status: string;
  step: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logFile: string | null;
}

/** A demo document, as `demo-factory/src/schema.mjs` defines it. */
interface DemoDocument {
  schemaVersion: number;
  id: string;
  title: string;
  description?: string;
  settings: Record<string, unknown>;
  scenes: {
    id: string;
    title: string;
    route: string;
    narration: string;
    actions?: unknown[];
    assertions?: unknown[];
  }[];
}

/**
 * Compound keys are built here and nowhere else.
 *
 * A scene id is only unique within its demo and a run scene only within its
 * run, so both need a prefix to be a clob key. `:` is safe as the separator
 * because `assertSafeId` already refuses it in a demo or scene id.
 */
export const sceneKey = (demoId: string, sceneId: string): string => `${demoId}:${sceneId}`;
export const runSceneKey = (runId: string, sceneId: string): string => `${runId}:${sceneId}`;
export const captionKey = (runId: string, sceneId: string, index: number): string => `${runId}:${sceneId}:${index}`;

export const hashDocument = (raw: string): string => `sha256:${createHash('sha256').update(raw).digest('hex')}`;

/** Split a demo document into the rows that hold it. */
export const demoToRows = (demo: DemoDocument, sourceHash = ''): { demo: DemoRow; scenes: SceneRow[] } => ({
  demo: {
    id: demo.id,
    title: demo.title,
    description: demo.description ?? '',
    schemaVersion: demo.schemaVersion,
    settings: demo.settings,
    sceneCount: demo.scenes?.length ?? 0,
    invalid: false,
    invalidReason: '',
    sourceHash,
    driftedFromFile: false,
    updatedAt: null
  },
  scenes: (demo.scenes ?? []).map((scene, index) => ({
    id: sceneKey(demo.id, scene.id),
    demoId: demo.id,
    sceneId: scene.id,
    sequence: index + 1,
    title: scene.title,
    route: scene.route,
    narration: scene.narration,
    actions: scene.actions ?? [],
    assertions: scene.assertions ?? []
  }))
});

/**
 * Put a demo document back together from its rows.
 *
 * Scene order is `sequence`, not the order the rows arrived in: a data source
 * is free to return them in any order, and the order of `scenes` is the order
 * the video is cut in.
 *
 * Nothing here validates. The caller writes the result and runs
 * `cli.mjs validate` over the file, so the zod schema — not this function —
 * decides whether the document is acceptable, exactly as it did when the
 * Studio wrote YAML directly.
 */
export const rowsToDemo = (demo: DemoRow, scenes: SceneRow[]): DemoDocument => ({
  schemaVersion: demo.schemaVersion,
  id: demo.id,
  title: demo.title,
  description: demo.description,
  settings: demo.settings,
  scenes: [...scenes]
    .filter((scene) => scene.demoId === demo.id)
    .sort((left, right) => left.sequence - right.sequence)
    .map((scene) => ({
      id: scene.sceneId,
      title: scene.title,
      route: scene.route,
      narration: scene.narration,
      actions: scene.actions ?? [],
      assertions: scene.assertions ?? []
    }))
});

/** The manifest a recorded run leaves in its directory. */
export interface RunManifest {
  demoId?: string;
  runId?: string;
  createdAt?: string;
  recordedAt?: string;
  baseUrl?: string;
  demoHash?: string;
  narrationProvider?: string;
  scenes?: {
    id: string;
    title: string;
    clipFile?: string;
    narrationFile?: string;
    alignmentFile?: string;
    narrationProvider?: string;
    narrationDurationMs?: number;
    recordedDurationMs?: number;
    narrationOffsetMs?: number;
    cues?: Record<string, number>;
    captions?: { text: string; startMs: number; endMs: number }[];
  }[];
}

/** Where the Studio streams a run's artefacts from. Mirrors DemoFactoryMedia's route. */
const mediaUrl = (demoId: string, runId: string, file: string): string =>
  `/service/app/demo-factory/media/${demoId}/${runId}/${file}`;

/**
 * Turn one run directory's manifest into its rows.
 *
 * `hasVideo` and `durationMs` come from the caller because they are facts about
 * the filesystem and the render result, not the manifest — keeping the stat
 * calls out of here is what lets this be a pure function with a test.
 */
export const manifestToRows = (
  manifest: RunManifest,
  context: { demoId: string; runId: string; hasVideo: boolean; durationMs: number | null }
): { run: RunRow; scenes: RunSceneRow[]; narration: NarrationRow[]; captions: CaptionRow[] } => {
  const { demoId, runId, hasVideo, durationMs } = context;
  const scenes = manifest.scenes ?? [];

  return {
    run: {
      runId,
      demoId,
      createdAt: manifest.createdAt || runId.split('--')[0],
      provider: manifest.narrationProvider || null,
      sceneCount: scenes.length,
      recordedScenes: scenes.filter((scene) => scene.clipFile).length,
      durationMs,
      hasVideo,
      demoHash: manifest.demoHash || '',
      baseUrl: manifest.baseUrl || '',
      recordedAt: manifest.recordedAt || null,
      videoUrl: hasVideo ? mediaUrl(demoId, runId, `${demoId}.mp4`) : '',
      srtUrl: hasVideo ? mediaUrl(demoId, runId, `${demoId}.srt`) : ''
    },
    scenes: scenes.map((scene, index) => ({
      id: runSceneKey(runId, scene.id),
      runId,
      demoId,
      sceneId: scene.id,
      sequence: index + 1,
      title: scene.title,
      // The same fallback the Studio's timeline used: a recorded duration when
      // the scene was filmed, else what the narration is expected to take.
      durationMs: scene.recordedDurationMs || scene.narrationDurationMs || null,
      hasClip: Boolean(scene.clipFile),
      narrationDurationMs: scene.narrationDurationMs ?? null,
      recordedDurationMs: scene.recordedDurationMs ?? null,
      narrationOffsetMs: scene.narrationOffsetMs ?? null,
      clipFile: scene.clipFile || '',
      cues: scene.cues ?? {}
    })),
    narration: scenes.map((scene, index) => ({
      id: runSceneKey(runId, scene.id),
      runId,
      demoId,
      sceneId: scene.id,
      sequence: index + 1,
      provider: scene.narrationProvider || manifest.narrationProvider || '',
      cacheKey: '',
      text: '',
      durationMs: scene.narrationDurationMs ?? null,
      cues: scene.cues ?? {},
      // Basenames only: the manifest stores absolute paths from the host that
      // recorded the run, which are meaningless to the browser and wrong on any
      // other host. The media controller resolves a file inside the run
      // directory, which is the only place these can legitimately live.
      audioUrl: scene.narrationFile ? mediaUrl(demoId, runId, `narration/${basename(scene.narrationFile)}`) : '',
      alignmentUrl: scene.alignmentFile ? mediaUrl(demoId, runId, `narration/${basename(scene.alignmentFile)}`) : ''
    })),
    captions: scenes.flatMap((scene) =>
      (scene.captions ?? []).map((caption, index) => ({
        id: captionKey(runId, scene.id, index),
        runId,
        demoId,
        sceneId: scene.id,
        index,
        startMs: caption.startMs,
        endMs: caption.endMs,
        text: caption.text
      }))
    )
  };
};

/** `path.basename` without importing path for one call — the manifest uses posix paths. */
const basename = (file: string): string => file.split('/').pop() || file;
