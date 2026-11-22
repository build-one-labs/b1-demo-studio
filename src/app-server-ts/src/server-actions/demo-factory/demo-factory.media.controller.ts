/* eslint-disable security/detect-non-literal-fs-filename --
 * Same reasoning as demo-factory.actions.ts: this controller exists to stream
 * files whose paths are built at runtime. Traversal is stopped at the door by
 * assertSafeId() and safeChildPath(), which refuse anything resolving outside
 * the run directory.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { Controller, Get, Headers, NotFoundException, Param, Res } from '@nestjs/common';

import { DemoFactoryFrames } from './demo-factory.frames';
import { DemoFactoryHost } from './demo-factory.host';
import { assertSafeId, safeChildPath } from './demo-factory.lib';

import type { Response } from 'express';

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.srt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8'
};

/**
 * Streams the artefacts of a recorded run to the Studio screen.
 *
 * This is the one part of the Studio server that cannot be a B1 action: a
 * `<video>` element issues its own GET with a Range header and expects a 206
 * back, which a JSON request/response action cannot express. Range support is
 * not optional — without it the browser can only play from the start and
 * seeking in the preview does nothing.
 */
/** The run subdirectories whose files may be streamed. Nothing else is reachable. */
const RUN_SUBDIRS = new Set(['narration', 'captions', 'clips', 'normalized']);

@Controller('demo-factory/media')
export class DemoFactoryMedia {
  constructor(
    private readonly host: DemoFactoryHost,
    private readonly frames: DemoFactoryFrames
  ) {}

  /**
   * The same file as the streaming route, as a download.
   *
   * Declared before the subdirectory route: both have four segments, and
   * routes match in declaration order — `download` is a reserved literal, so
   * a run subdirectory of that name (which RUN_SUBDIRS does not list) cannot
   * shadow it.
   */
  @Get(':demoId/:runId/download/:file')
  async download(
    @Param('demoId') demoId: string,
    @Param('runId') runId: string,
    @Param('file') file: string,
    @Res() response: Response
  ): Promise<void> {
    const resolved = this.resolve(demoId, runId, file);
    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException();

    response.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'content-length': info.size,
      'content-disposition': `attachment; filename="${file}"`
    });
    createReadStream(resolved).pipe(response);
  }

  /**
   * A still frame of an uploaded recording, `ms` into it — the reel of the
   * Studio home screen for a video demo that has not been rendered yet.
   *
   * Declared before the run routes: `uploads` is a reserved output directory,
   * never a demo id, so it cannot shadow one.
   */
  @Get('uploads/:uploadId/frame/:ms')
  async uploadFrame(
    @Param('uploadId') uploadId: string,
    @Param('ms') ms: string,
    @Res() response: Response
  ): Promise<void> {
    if (!/^[\w-]+$/.test(uploadId) || !/^\d{1,9}$/.test(ms)) throw new NotFoundException();
    await this.sendFrame(await this.frames.uploadFrame(uploadId, Number(ms)), response);
  }

  /** A still frame from the middle of a run scene's clip — the reel of the Studio home screen. */
  @Get(':demoId/:runId/frame/:sceneId')
  async runSceneFrame(
    @Param('demoId') demoId: string,
    @Param('runId') runId: string,
    @Param('sceneId') sceneId: string,
    @Res() response: Response
  ): Promise<void> {
    this.resolve(demoId, runId, sceneId);
    await this.sendFrame(await this.frames.runSceneFrame(demoId, runId, sceneId), response);
  }

  /** A file inside a run subdirectory — narration audio, captions, raw clips. */
  @Get(':demoId/:runId/:sub/:file')
  async mediaInSubdir(
    @Param('demoId') demoId: string,
    @Param('runId') runId: string,
    @Param('sub') sub: string,
    @Param('file') file: string,
    @Headers('range') range: string | undefined,
    @Res() response: Response
  ): Promise<void> {
    if (!RUN_SUBDIRS.has(sub)) throw new NotFoundException();
    await this.stream(this.resolve(demoId, runId, sub, file), range, response);
  }

  @Get(':demoId/:runId/:file')
  async media(
    @Param('demoId') demoId: string,
    @Param('runId') runId: string,
    @Param('file') file: string,
    @Headers('range') range: string | undefined,
    @Res() response: Response
  ): Promise<void> {
    await this.stream(this.resolve(demoId, runId, file), range, response);
  }

  /** Frames never change once cut: the browser may keep them for a day. */
  private async sendFrame(file: string, response: Response): Promise<void> {
    const info = await stat(file);
    response.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': info.size,
      'cache-control': 'private, max-age=86400'
    });
    createReadStream(file).pipe(response);
  }

  private resolve(demoId: string, runId: string, ...segments: string[]): string {
    assertSafeId(demoId, 'demo id');
    // A run id is a timestamp plus a hash, so it carries dots and colons that
    // assertSafeId would reject; safeChildPath is what actually contains it.
    if (!/^[\w.:-]+$/.test(runId) || segments.some((segment) => !/^[\w.-]+$/.test(segment))) {
      throw new NotFoundException();
    }
    return safeChildPath(this.host.outputRoot(), demoId, runId, ...segments);
  }

  private async stream(resolved: string, range: string | undefined, response: Response): Promise<void> {
    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException();

    const contentType = CONTENT_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;

    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        response.writeHead(416, { 'content-range': `bytes */${info.size}` }).end();
        return;
      }
      response.writeHead(206, {
        'content-type': contentType,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${info.size}`,
        'accept-ranges': 'bytes'
      });
      createReadStream(resolved, { start, end }).pipe(response);
      return;
    }

    response.writeHead(200, { 'content-type': contentType, 'content-length': info.size, 'accept-ranges': 'bytes' });
    createReadStream(resolved).pipe(response);
  }
}
