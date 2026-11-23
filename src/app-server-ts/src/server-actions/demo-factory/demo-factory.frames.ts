/* eslint-disable security/detect-non-literal-fs-filename --
 * Same reasoning as the media controller: the paths are built at runtime from
 * ids it has already checked, and every one goes through safeChildPath().
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { DemoFactoryHost } from './demo-factory.host';
import { safeChildPath } from './demo-factory.lib';
import { RunManifest } from './demo-factory.rows';

/** Frames are thumbnails for the home screen's reel, not stills for print. */
const FRAME_WIDTH = 640;

/**
 * Still frames for the Studio home screen, cut from footage that already
 * exists: a run's recorded scene clips, or an uploaded screen recording.
 *
 * Cut on first request and kept beside the footage (`frames/` in the run or
 * upload directory), so the reel costs one ffmpeg call per frame once and a
 * file read after that — and a frame disappears with the footage it came from.
 */
@Injectable()
export class DemoFactoryFrames {
  private readonly logger = new Logger(DemoFactoryFrames.name);

  /** The cut in flight per output file, so a reel opened twice does not cut twice. */
  private readonly cutting = new Map<string, Promise<void>>();

  constructor(private readonly host: DemoFactoryHost) {}

  /** The frame from the middle of a run scene's recorded clip. */
  async runSceneFrame(demoId: string, runId: string, sceneId: string): Promise<string> {
    const runDir = safeChildPath(this.host.outputRoot(), demoId, runId);
    const output = safeChildPath(runDir, 'frames', `${sceneId}.jpg`);
    if (await isFile(output)) return output;

    const manifest = JSON.parse(await readFile(path.join(runDir, 'run-manifest.json'), 'utf8')) as RunManifest;
    const scene = manifest.scenes?.find((candidate) => candidate.id === sceneId);
    if (!scene) throw new NotFoundException();

    // The normalized clip seeks fastest (H.264, constant frame rate); the raw
    // recording is the fallback for a run that was never rendered.
    const clip =
      (await firstFile(safeChildPath(runDir, 'normalized'), (name) => name.startsWith(`${sceneId}.`))) ??
      (scene.clipFile ? await existing(safeChildPath(runDir, 'clips', path.basename(scene.clipFile))) : null);
    if (!clip) throw new NotFoundException();

    const durationMs = scene.recordedDurationMs ?? scene.narrationDurationMs ?? 2_000;
    await this.cut(clip, durationMs / 2 / 1000, output);
    return output;
  }

  /** The frame `ms` into an uploaded recording. */
  async uploadFrame(uploadId: string, ms: number): Promise<string> {
    const uploadDir = safeChildPath(this.host.outputRoot(), 'uploads', uploadId);
    const output = safeChildPath(uploadDir, 'frames', `${ms}.jpg`);
    if (await isFile(output)) return output;

    const source = await firstFile(uploadDir, (name) => /^source\.\w+$/.test(name));
    if (!source) throw new NotFoundException();
    await this.cut(source, ms / 1000, output);
    return output;
  }

  private cut(input: string, atSeconds: number, output: string): Promise<void> {
    const inFlight = this.cutting.get(output);
    if (inFlight) return inFlight;
    const run = this.extract(input, atSeconds, output).finally(() => this.cutting.delete(output));
    this.cutting.set(output, run);
    return run;
  }

  /** One frame, scaled, written to a temporary name and renamed: a half-written JPEG is never served. */
  private async extract(input: string, atSeconds: number, output: string): Promise<void> {
    await mkdir(path.dirname(output), { recursive: true });
    const partial = `${output}.${process.pid}.part.jpg`;
    const ffmpeg = this.host.definedEnv().FFMPEG_PATH || process.env.FFMPEG_PATH || 'ffmpeg';
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      atSeconds.toFixed(3),
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      `scale=${FRAME_WIDTH}:-2`,
      '-q:v',
      '4',
      '-y',
      partial
    ];
    const { code, output: log } = await new Promise<{ code: number; output: string }>((resolve) => {
      const child = spawn(ffmpeg, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (data) => (stderr += String(data)));
      child.once('error', (error) => resolve({ code: -1, output: error.message }));
      child.once('exit', (exitCode) => resolve({ code: exitCode ?? -1, output: stderr }));
    });
    if (code !== 0 || !(await isFile(partial))) {
      await rm(partial, { force: true });
      this.logger.warn(`No frame from ${path.basename(input)} at ${atSeconds}s: ${log.trim().slice(0, 300)}`);
      throw new NotFoundException();
    }
    await rename(partial, output);
  }
}

const isFile = (file: string): Promise<boolean> =>
  stat(file).then(
    (info) => info.isFile() && info.size > 0,
    () => false
  );

const existing = async (file: string): Promise<string | null> => ((await isFile(file)) ? file : null);

const firstFile = async (directory: string, matches: (name: string) => boolean): Promise<string | null> => {
  const names = await readdir(directory).catch(() => [] as string[]);
  const name = names.filter(matches).sort()[0];
  return name ? existing(path.join(directory, name)) : null;
};
