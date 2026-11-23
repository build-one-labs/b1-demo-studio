import { DemoRow, RunRow, RunSceneRow, SceneRow } from './demo-factory.rows';

/**
 * The Studio home screen's reel: every demo as a strip of film, one frame per
 * scene.
 *
 * A frame shows what the scene actually looks like, taken from the best
 * footage there is for the demo:
 *
 * - **a rendered run** — the newest run with a video, one frame from the middle
 *   of each recorded scene clip (`frame` route of the media controller);
 * - **the source recording** of a video demo that has not been rendered yet —
 *   one frame from the middle of each scene's clip range;
 * - **nothing** — a demo that was never filmed gets its scenes as blank,
 *   titled frames, which is honest about the state it is in.
 *
 * Pure, so the selection is testable without a filesystem; the frames are cut
 * lazily by the media controller when the browser first asks for them.
 */

export interface ReelFrame {
  sceneId: string;
  title: string;
  /** Empty when there is no footage for this scene. */
  imageUrl: string;
}

export interface ReelDemo {
  id: string;
  title: string;
  description: string;
  sceneCount: number;
  /** Where the frames come from — see the module comment. */
  footage: 'run' | 'source' | 'none';
  frames: ReelFrame[];
  /** The newest rendered run's video, empty when there is none. */
  videoUrl: string;
  runId: string;
  durationMs: number | null;
  recordedAt: string | null;
  editedAt: string | null;
  invalid: boolean;
  /** E-mail of the user who created the demo; empty for one from the repository's files. */
  owner: string;
}

const MEDIA = '/service/app/demo-factory/media';

const FOOTAGE_ORDER: Record<ReelDemo['footage'], number> = { run: 0, source: 1, none: 2 };

/** The frame of a run scene: the media controller cuts it from the scene's recorded clip. */
export const runFrameUrl = (demoId: string, runId: string, sceneId: string): string =>
  `${MEDIA}/${encodeURIComponent(demoId)}/${encodeURIComponent(runId)}/frame/${encodeURIComponent(sceneId)}`;

/** A frame of an uploaded recording, `ms` into it. */
export const sourceFrameUrl = (uploadId: string, ms: number): string =>
  `${MEDIA}/uploads/${encodeURIComponent(uploadId)}/frame/${Math.max(0, Math.round(ms))}`;

/** `source.video` of a video demo is `<uploadId>/<file>` under the uploads directory. */
const uploadOf = (demo: DemoRow): string => {
  const video = demo.source?.video ?? '';
  const [uploadId] = video.split('/');
  return video.includes('/') && uploadId ? uploadId : '';
};

export const buildReel = (demos: DemoRow[], scenes: SceneRow[], runs: RunRow[], runScenes: RunSceneRow[]): ReelDemo[] =>
  [...demos]
    .map((demo) => {
      const own = scenes.filter((scene) => scene.demoId === demo.id).sort((a, b) => a.sequence - b.sequence);
      const run = runs
        .filter((candidate) => candidate.demoId === demo.id && candidate.hasVideo)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

      let footage: ReelDemo['footage'] = 'none';
      let frames: ReelFrame[] = own.map((scene) => ({ sceneId: scene.sceneId, title: scene.title, imageUrl: '' }));

      if (run) {
        const recorded = runScenes
          .filter((scene) => scene.runId === run.runId && scene.hasClip)
          .sort((a, b) => a.sequence - b.sequence);
        if (recorded.length > 0) {
          footage = 'run';
          frames = recorded.map((scene) => ({
            sceneId: scene.sceneId,
            title: scene.title,
            imageUrl: runFrameUrl(demo.id, run.runId, scene.sceneId)
          }));
        }
      }

      const uploadId = uploadOf(demo);
      if (footage === 'none' && uploadId && own.some((scene) => scene.clip)) {
        footage = 'source';
        frames = own.map((scene) => ({
          sceneId: scene.sceneId,
          title: scene.title,
          imageUrl: scene.clip
            ? sourceFrameUrl(uploadId, scene.clip.startMs + (scene.clip.endMs - scene.clip.startMs) / 2)
            : ''
        }));
      }

      return {
        id: demo.id,
        title: demo.title || demo.id,
        description: demo.description ?? '',
        sceneCount: own.length > 0 ? own.length : demo.sceneCount,
        footage,
        frames,
        videoUrl: run?.videoUrl ?? '',
        runId: run?.runId ?? '',
        durationMs: run?.durationMs ?? demo.source?.durationMs ?? null,
        recordedAt: run?.recordedAt ?? run?.createdAt ?? null,
        editedAt: demo.editedAt,
        invalid: demo.invalid,
        owner: demo.owner ?? ''
      };
    })
    // Footage first — the reel opens on pictures — then by title.
    .sort(
      (left, right) =>
        FOOTAGE_ORDER[left.footage] - FOOTAGE_ORDER[right.footage] || left.title.localeCompare(right.title)
    );
