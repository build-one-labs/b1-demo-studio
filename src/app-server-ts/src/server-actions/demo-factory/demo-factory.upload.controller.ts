/* eslint-disable security/detect-non-literal-fs-filename --
 * Same reasoning as demo-factory.actions.ts: uploads land under a directory
 * built at runtime. Nothing from the browser reaches a path — the upload id is
 * generated here and the file name is a fixed `source` plus a whitelisted
 * extension — and safeChildPath() contains the result in the uploads root.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { RequestContext } from '@buildone/app-server-tslib/modules';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import { DemoFactoryHost } from './demo-factory.host';
import {
  assertOperator,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_CHUNK_BYTES,
  newUploadId,
  safeChildPath,
  UPLOAD_ID_PATTERN,
  VIDEO_EXTENSIONS
} from './demo-factory.lib';

import type { Request } from 'express';
import type { Readable } from 'node:stream';

/** The part of a multer file this controller reads. */
interface UploadedVideo {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
  uploadId: string;
}

interface IncomingFile {
  originalname: string;
  mimetype: string;
  stream: Readable;
}

/** What `upload/start` records, until `upload/:id/finish` turns it into upload.json. */
interface PendingUpload {
  uploadId: string;
  file: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  startedAt: string;
  uploadedBy: string | null;
}

const PENDING_FILE = 'upload.partial.json';

type StorageCallback = (error: Error | null, info?: Partial<UploadedVideo>) => void;

/**
 * A multer storage engine that streams the upload straight into its own
 * directory under `<output>/uploads/`.
 *
 * Its own engine rather than multer's `diskStorage` for two reasons: the
 * destination is the output root as configured *now* (Settings may have moved
 * it since start-up), and a screen recording is gigabytes, so it must never be
 * buffered or land in a temp directory on another filesystem first.
 */
class UploadStorage {
  constructor(private readonly uploadsRoot: () => string) {}

  _handleFile(_request: Request, file: IncomingFile, callback: StorageCallback): void {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!VIDEO_EXTENSIONS.has(extension)) {
      callback(new BadRequestException(`Not a video file — upload ${[...VIDEO_EXTENSIONS].join(', ')}`));
      return;
    }
    const uploadId = newUploadId();
    const directory = safeChildPath(this.uploadsRoot(), uploadId);
    const target = path.join(directory, `source${extension}`);
    // No 'data' listener for counting: it would start the stream flowing
    // before the directory exists, and the first chunks would be lost.
    mkdir(directory, { recursive: true })
      .then(() => pipeline(file.stream, createWriteStream(target)))
      .then(() => stat(target))
      .then(({ size }) => callback(null, { path: target, size, uploadId }))
      .catch(async (error: Error) => {
        await rm(directory, { recursive: true, force: true });
        callback(error);
      });
  }

  _removeFile(_request: Request, file: Partial<UploadedVideo>, callback: (error: Error | null) => void): void {
    if (!file.path) {
      callback(null);
      return;
    }
    rm(path.dirname(file.path), { recursive: true, force: true }).then(
      () => callback(null),
      (error: Error) => callback(error)
    );
  }
}

/**
 * Upload of a screen recording for a new video demo.
 *
 * The one write the Studio cannot make as a B1 action, for the same reason the
 * media routes cannot read as one: a file of this size is multipart, not JSON.
 * The framework's `b1_file_upload` posts its files here as the `files` field;
 * the answer is the upload id the Studio then hands to `import-video`.
 */
@Controller('demo-factory')
export class DemoFactoryUpload {
  private readonly logger = new Logger(DemoFactoryUpload.name);

  /**
   * Uploads a chunk is being written to right now. The offset check and the
   * append are not one step on disk, so a second chunk for the same upload —
   * a retry, a second tab — waits its turn as a 409 and resumes from `status`.
   */
  private readonly writing = new Set<string>();

  constructor(
    private readonly host: DemoFactoryHost,
    private readonly ctx: RequestContext
  ) {}

  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 1, {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      storage: new UploadStorage(() => path.join(DemoFactoryUpload.outputRoot(), 'uploads'))
    })
  )
  async upload(@UploadedFiles() files: UploadedVideo[] = []) {
    const file = files[0];
    if (!file) throw new BadRequestException('No video in the upload');
    const directory = path.dirname(file.path);
    try {
      assertOperator((this.ctx.user as { email?: string } | undefined)?.email);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw new ForbiddenException((error as Error).message);
    }

    const meta = {
      uploadId: file.uploadId,
      file: path.basename(file.path),
      originalName: path.basename(file.originalname || ''),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedAt: new Date().toISOString(),
      uploadedBy: (this.ctx.user as { email?: string } | undefined)?.email ?? null
    };
    await writeFile(path.join(directory, 'upload.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    this.logger.log(`Upload ${meta.uploadId}: ${meta.originalName} (${(meta.sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
    return meta;
  }

  /**
   * Chunked upload — what the Studio uses. A single multipart POST of a whole
   * recording does not get through every proxy: GitHub Codespaces' port
   * forwarding refuses a request body over ~15 MB with 413 before it reaches
   * this server. So the browser sends `start`, then the file in slices of at
   * most MAX_UPLOAD_CHUNK_BYTES as raw bodies, then `finish`.
   *
   * A chunk names the offset it starts at and is only appended there; on a
   * mismatch (a retried or half-written chunk) the answer is 409, and the
   * browser asks `status` how many bytes arrived and resumes from there.
   */
  @Post('upload/start')
  async startUpload(@Body() body: { fileName?: string; sizeBytes?: number; mimeType?: string }) {
    const email = this.operatorEmail();
    const originalName = path.basename(String(body?.fileName ?? ''));
    const extension = path.extname(originalName).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(extension)) {
      throw new BadRequestException(`Not a video file — upload ${[...VIDEO_EXTENSIONS].join(', ')}`);
    }
    const sizeBytes = Number(body?.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new BadRequestException('The file is empty');
    if (sizeBytes > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 ** 3} GB`);
    }
    const uploadId = newUploadId();
    const directory = this.uploadDirectory(uploadId);
    const pending: PendingUpload = {
      uploadId,
      file: `source${extension}`,
      originalName,
      mimeType: String(body?.mimeType ?? ''),
      sizeBytes,
      startedAt: new Date().toISOString(),
      uploadedBy: email ?? null
    };
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, pending.file), '');
    await writeFile(path.join(directory, PENDING_FILE), `${JSON.stringify(pending, null, 2)}\n`, 'utf8');
    return { uploadId, chunkBytes: MAX_UPLOAD_CHUNK_BYTES };
  }

  @Post('upload/:uploadId/chunk')
  @HttpCode(200)
  async uploadChunk(
    @Param('uploadId') uploadId: string,
    @Query('offset') offsetParam: string,
    @Req() request: Request
  ) {
    if (this.writing.has(uploadId)) {
      request.resume();
      throw new ConflictException('Another chunk of this upload is being written — ask status and resume');
    }
    this.writing.add(uploadId);
    try {
      return await this.appendChunk(uploadId, offsetParam, request);
    } finally {
      this.writing.delete(uploadId);
    }
  }

  private async appendChunk(uploadId: string, offsetParam: string, request: Request) {
    const { pending, target } = await this.pendingUpload(uploadId);
    const received = (await stat(target)).size;
    const offset = Number(offsetParam);
    if (!Number.isSafeInteger(offset) || offset !== received) {
      request.resume();
      throw new ConflictException(`Chunk out of order: the upload holds ${received} bytes`);
    }
    const declared = Number(request.headers['content-length']);
    if (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_UPLOAD_CHUNK_BYTES) {
      request.resume();
      throw new BadRequestException(`A chunk is 1 to ${MAX_UPLOAD_CHUNK_BYTES} bytes, with a Content-Length`);
    }
    if (received + declared > pending.sizeBytes) {
      request.resume();
      throw new BadRequestException('The chunk runs past the announced file size');
    }
    // flags 'a': appended at the end, which the offset check put at `offset`.
    await pipeline(request, createWriteStream(target, { flags: 'a' }));
    return { receivedBytes: (await stat(target)).size };
  }

  /** How many bytes of an unfinished upload arrived: where the browser resumes after a failed chunk. */
  @Post('upload/:uploadId/status')
  @HttpCode(200)
  async uploadStatus(@Param('uploadId') uploadId: string) {
    const { pending, target } = await this.pendingUpload(uploadId);
    return { receivedBytes: (await stat(target)).size, sizeBytes: pending.sizeBytes };
  }

  @Post('upload/:uploadId/finish')
  @HttpCode(200)
  async finishUpload(@Param('uploadId') uploadId: string) {
    const { pending, directory, target } = await this.pendingUpload(uploadId);
    const received = (await stat(target)).size;
    if (received !== pending.sizeBytes) {
      throw new ConflictException(`Only ${received} of ${pending.sizeBytes} bytes arrived`);
    }
    const meta = {
      uploadId: pending.uploadId,
      file: pending.file,
      originalName: pending.originalName,
      mimeType: pending.mimeType,
      sizeBytes: received,
      uploadedAt: new Date().toISOString(),
      uploadedBy: pending.uploadedBy
    };
    await writeFile(path.join(directory, 'upload.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    await rm(path.join(directory, PENDING_FILE), { force: true });
    this.logger.log(`Upload ${meta.uploadId}: ${meta.originalName} (${(meta.sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
    return meta;
  }

  /** The signed-in user, if they may operate the factory; otherwise 403. */
  private operatorEmail(): string | undefined {
    const email = (this.ctx.user as { email?: string } | undefined)?.email;
    try {
      assertOperator(email);
    } catch (error) {
      throw new ForbiddenException((error as Error).message);
    }
    return email;
  }

  private uploadDirectory(uploadId: string): string {
    if (!UPLOAD_ID_PATTERN.test(uploadId || '')) throw new BadRequestException('Invalid upload id');
    return safeChildPath(path.join(DemoFactoryUpload.outputRoot(), 'uploads'), uploadId);
  }

  /** An upload begun with `start` and not finished yet, begun by the same user. */
  private async pendingUpload(uploadId: string) {
    const email = this.operatorEmail();
    const directory = this.uploadDirectory(uploadId);
    let pending: PendingUpload;
    try {
      pending = JSON.parse(await readFile(path.join(directory, PENDING_FILE), 'utf8')) as PendingUpload;
    } catch {
      throw new NotFoundException(`No unfinished upload ${uploadId}`);
    }
    if ((pending.uploadedBy ?? null) !== (email ?? null))
      throw new ForbiddenException('Another user started this upload');
    return { pending, directory, target: path.join(directory, path.basename(pending.file)) };
  }

  /**
   * The decorator's storage is built once, at class definition — before Nest
   * has injected the host. This static is how it reaches the instance that
   * resolves the configured output root.
   */
  private static instance: DemoFactoryUpload | undefined;

  private static outputRoot(): string {
    if (!DemoFactoryUpload.instance) throw new Error('The upload controller is not initialised');
    return DemoFactoryUpload.instance.host.outputRoot();
  }

  onModuleInit(): void {
    DemoFactoryUpload.instance = this;
  }
}
