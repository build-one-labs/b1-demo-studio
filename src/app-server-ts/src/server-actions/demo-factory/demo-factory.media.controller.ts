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

import { assertSafeId, safeChildPath } from './demo-factory.lib';

import type { Response } from 'express';

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.srt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
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
@Controller('demo-factory/media')
export class DemoFactoryMedia {
  private readonly projectRoot = process.env.DEMO_FACTORY_ROOT || path.resolve(process.cwd(), '..', 'demo-factory');

  private outputRoot(): string {
    const configured = process.env.DEMO_OUTPUT_DIR;
    return configured ? path.resolve(this.projectRoot, configured) : path.join(this.projectRoot, 'output');
  }

  @Get(':demoId/:runId/:file')
  async media(
    @Param('demoId') demoId: string,
    @Param('runId') runId: string,
    @Param('file') file: string,
    @Headers('range') range: string | undefined,
    @Res() response: Response
  ): Promise<void> {
    assertSafeId(demoId, 'demo id');
    // A run id is a timestamp plus a hash, so it carries dots and colons that
    // assertSafeId would reject; safeChildPath is what actually contains it.
    if (!/^[\w.:-]+$/.test(runId) || !/^[\w.-]+$/.test(file)) throw new NotFoundException();

    const resolved = safeChildPath(this.outputRoot(), demoId, runId, file);
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
