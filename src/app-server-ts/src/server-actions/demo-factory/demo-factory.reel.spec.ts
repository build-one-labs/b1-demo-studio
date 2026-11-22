import { buildReel, runFrameUrl, sourceFrameUrl } from './demo-factory.reel';
import { DemoRow, demoToRows, RunRow, RunSceneRow, SceneRow } from './demo-factory.rows';

const demo = (id: string, title: string, scenes: SceneRow['clip'][], source?: DemoRow['source']) => {
  const rows = demoToRows({
    schemaVersion: 1,
    id,
    title,
    settings: {},
    ...(source ? { source } : {}),
    scenes: scenes.map((clip, index) => ({
      id: `s${index + 1}`,
      title: `Scene ${index + 1}`,
      narration: 'Hello.',
      ...(clip ? { clip } : { route: '/' })
    }))
  });
  return rows;
};

const run = (demoId: string, runId: string, hasVideo: boolean): RunRow => ({
  runId,
  demoId,
  createdAt: runId,
  provider: 'silent',
  sceneCount: 2,
  recordedScenes: 2,
  durationMs: 61_000,
  hasVideo,
  demoHash: '',
  baseUrl: '',
  recordedAt: null,
  videoUrl: hasVideo ? `/video/${runId}` : '',
  srtUrl: ''
});

const runScene = (demoId: string, runId: string, sceneId: string, sequence: number, hasClip = true): RunSceneRow => ({
  id: `${runId}:${sceneId}`,
  runId,
  demoId,
  sceneId,
  sequence,
  title: `Recorded ${sceneId}`,
  durationMs: 1000,
  hasClip,
  narrationDurationMs: null,
  recordedDurationMs: 1000,
  narrationOffsetMs: null,
  clipFile: '',
  cues: {}
});

describe('buildReel', () => {
  it('takes the frames from the newest run that has a video', () => {
    const filmed = demo('filmed', 'Filmed', [null, null]);
    const reel = buildReel(
      [filmed.demo],
      filmed.scenes,
      [run('filmed', '2026-01-01', true), run('filmed', '2026-03-01', false), run('filmed', '2026-02-01', true)],
      [
        runScene('filmed', '2026-02-01', 's2', 2),
        runScene('filmed', '2026-02-01', 's1', 1),
        runScene('filmed', '2026-02-01', 'lost', 3, false),
        runScene('filmed', '2026-01-01', 's1', 1)
      ]
    );

    expect(reel[0]).toMatchObject({
      footage: 'run',
      runId: '2026-02-01',
      videoUrl: '/video/2026-02-01',
      durationMs: 61_000
    });
    expect(reel[0].frames).toEqual([
      { sceneId: 's1', title: 'Recorded s1', imageUrl: runFrameUrl('filmed', '2026-02-01', 's1') },
      { sceneId: 's2', title: 'Recorded s2', imageUrl: runFrameUrl('filmed', '2026-02-01', 's2') }
    ]);
  });

  it('cuts the frames of an unrendered video demo from the middle of each clip of its recording', () => {
    const video = demo('video', 'Video', [{ startMs: 0, endMs: 4000 }, null], {
      video: 'upload-1/source.mp4',
      durationMs: 9000
    });
    const [entry] = buildReel([video.demo], video.scenes, [], []);

    expect(entry.footage).toBe('source');
    expect(entry.frames.map((frame) => frame.imageUrl)).toEqual([sourceFrameUrl('upload-1', 2000), '']);
    expect(entry.durationMs).toBe(9000);
  });

  it('shows a never-filmed demo as blank frames, after the demos with footage', () => {
    const blank = demo('blank', 'Aaa first by title', [null]);
    const filmed = demo('filmed', 'Zzz last by title', [null]);
    const reel = buildReel(
      [blank.demo, filmed.demo],
      [...blank.scenes, ...filmed.scenes],
      [run('filmed', 'r1', true)],
      [runScene('filmed', 'r1', 's1', 1)]
    );

    expect(reel.map((entry) => entry.id)).toEqual(['filmed', 'blank']);
    expect(reel[1]).toMatchObject({
      footage: 'none',
      videoUrl: '',
      frames: [{ sceneId: 's1', title: 'Scene 1', imageUrl: '' }]
    });
  });

  it('keeps ids out of the frame URLs path syntax', () => {
    expect(runFrameUrl('demo', '2026-11-21T19-00-51-824Z--141e1600', 'scene 1')).toBe(
      '/service/app/demo-factory/media/demo/2026-11-21T19-00-51-824Z--141e1600/frame/scene%201'
    );
  });
});
