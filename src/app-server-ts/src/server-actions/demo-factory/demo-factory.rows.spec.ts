import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

import { demoToRows, hashDocument, manifestToRows, rowsToDemo, sceneKey } from './demo-factory.rows';

/**
 * The demo documents are the only thing in this migration that cannot be
 * regenerated: a lossy split into rows silently rewrites a demo the next time
 * the server materializes it. So the round trip is tested against the real
 * files in `demo-factory/demos/`, not a fixture — a demo added to the
 * repository is covered the moment it lands.
 */
const demosRoot = path.resolve(__dirname, '..', '..', '..', 'demo-factory', 'demos');

const demoFiles = readdirSync(demosRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ id: entry.name, file: path.join(demosRoot, entry.name, 'demo.yaml') }));

describe('demo document <-> rows', () => {
  it('finds the repository demos', () => {
    expect(demoFiles.length).toBeGreaterThan(0);
  });

  it.each(demoFiles)('round-trips $id without losing anything', ({ file }) => {
    const raw = readFileSync(file, 'utf8');
    const original = YAML.parse(raw);

    const { demo, scenes } = demoToRows(original, hashDocument(raw));
    const rebuilt = rowsToDemo(demo, scenes);

    // `description` and the per-scene `actions`/`assertions` arrays are the
    // only fields the split defaults, and the schema defaults them the same way.
    expect(rebuilt).toEqual({
      ...original,
      description: original.description ?? '',
      scenes: original.scenes.map((scene: Record<string, unknown>) => ({
        id: scene.id,
        title: scene.title,
        route: scene.route,
        narration: scene.narration,
        actions: scene.actions ?? [],
        assertions: scene.assertions ?? []
      }))
    });
  });

  it.each(demoFiles)('keys and orders the scenes of $id', ({ id, file }) => {
    const original = YAML.parse(readFileSync(file, 'utf8'));
    const { demo, scenes } = demoToRows(original);

    expect(demo.sceneCount).toBe(original.scenes.length);
    expect(scenes.map((scene) => scene.id)).toEqual(
      original.scenes.map((scene: { id: string }) => sceneKey(id, scene.id))
    );
    expect(scenes.map((scene) => scene.sequence)).toEqual(
      original.scenes.map((_: unknown, index: number) => index + 1)
    );
  });

  it('rebuilds scenes in sequence order, whatever order the rows arrive in', () => {
    const original = YAML.parse(readFileSync(demoFiles[0].file, 'utf8'));
    const { demo, scenes } = demoToRows(original);

    const rebuilt = rowsToDemo(demo, [...scenes].reverse());

    expect(rebuilt.scenes.map((scene) => scene.id)).toEqual(original.scenes.map((scene: { id: string }) => scene.id));
  });

  it('ignores scene rows belonging to another demo', () => {
    const original = YAML.parse(readFileSync(demoFiles[0].file, 'utf8'));
    const { demo, scenes } = demoToRows(original);

    const rebuilt = rowsToDemo(demo, [
      ...scenes,
      { ...scenes[0], id: 'other:intro', demoId: 'other-demo', sceneId: 'intro', sequence: 99 }
    ]);

    expect(rebuilt.scenes).toHaveLength(original.scenes.length);
  });

  it('hashes a document stably', () => {
    const raw = readFileSync(demoFiles[0].file, 'utf8');

    expect(hashDocument(raw)).toBe(hashDocument(raw));
    expect(hashDocument(raw)).not.toBe(hashDocument(`${raw}\n`));
    expect(hashDocument(raw)).toMatch(/^sha256:[\da-f]{64}$/);
  });
});

describe('run manifest -> rows', () => {
  const manifest = {
    demoId: 'a-demo',
    createdAt: '2026-08-16T10:50:26.336Z',
    recordedAt: '2026-08-16T10:51:00.000Z',
    baseUrl: 'http://caddy:8080',
    demoHash: 'sha256:abc',
    narrationProvider: 'silent',
    scenes: [
      {
        id: 'one',
        title: 'One',
        clipFile: '/abs/run/clips/one.webm',
        narrationFile: '/abs/run/narration/one.wav',
        alignmentFile: '/abs/run/narration/one.alignment.json',
        narrationDurationMs: 26_964,
        recordedDurationMs: 27_500,
        narrationOffsetMs: 0,
        cues: { 'show-list': 1200 },
        captions: [
          { text: 'Hello', startMs: 0, endMs: 900 },
          { text: 'World', startMs: 950, endMs: 1800 }
        ]
      },
      { id: 'two', title: 'Two', narrationDurationMs: 12_000 }
    ]
  };

  const context = { demoId: 'a-demo', runId: '2026-08-16T10-50-26-336Z--7c9380c0', hasVideo: true, durationMs: 39_500 };

  it('summarizes the run', () => {
    const { run } = manifestToRows(manifest, context);

    expect(run).toMatchObject({
      runId: context.runId,
      demoId: 'a-demo',
      provider: 'silent',
      sceneCount: 2,
      recordedScenes: 1,
      durationMs: 39_500,
      hasVideo: true
    });
    expect(run.videoUrl).toBe(`/service/app/demo-factory/media/a-demo/${context.runId}/a-demo.mp4`);
  });

  it('leaves the media urls empty when there is no video', () => {
    const { run } = manifestToRows(manifest, { ...context, hasVideo: false });

    expect(run.videoUrl).toBe('');
    expect(run.srtUrl).toBe('');
  });

  it('falls back to the narration duration for a scene that was never recorded', () => {
    const { scenes } = manifestToRows(manifest, context);

    expect(scenes[0]).toMatchObject({ durationMs: 27_500, hasClip: true });
    expect(scenes[1]).toMatchObject({ durationMs: 12_000, hasClip: false });
  });

  it('rewrites the recording host absolute paths into media urls', () => {
    const { narration } = manifestToRows(manifest, context);

    expect(narration[0].audioUrl).toBe(`/service/app/demo-factory/media/a-demo/${context.runId}/narration/one.wav`);
    expect(narration[0].alignmentUrl).toBe(
      `/service/app/demo-factory/media/a-demo/${context.runId}/narration/one.alignment.json`
    );
    expect(narration[1].audioUrl).toBe('');
  });

  it('flattens the captions of every scene into keyed rows', () => {
    const { captions } = manifestToRows(manifest, context);

    expect(captions).toHaveLength(2);
    expect(captions[0]).toMatchObject({ sceneId: 'one', index: 0, startMs: 0, endMs: 900, text: 'Hello' });
    expect(captions[1].id).toBe(`${context.runId}:one:1`);
  });

  it('takes the run id apart for a manifest with no createdAt', () => {
    const { run } = manifestToRows({ ...manifest, createdAt: undefined }, context);

    expect(run.createdAt).toBe('2026-08-16T10-50-26-336Z');
  });
});
