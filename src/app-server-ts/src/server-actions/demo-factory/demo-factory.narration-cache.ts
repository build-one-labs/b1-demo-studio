/* eslint-disable security/detect-non-literal-fs-filename --
 * Same reasoning as the run ingest: this service mirrors the pipeline's cache
 * directory, whose paths are built at runtime from the configured cache root
 * and content-hash filenames matched against a strict pattern.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DRIZZLE } from '@buildone/app-server-tslib/drizzle';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { demoNarrationCache } from 'src/drizzle/schema';

import { DemoFactoryHost } from './demo-factory.host';

import type * as schema from 'src/drizzle/schema';

/** `<sha256>.json` beside `<sha256>.mp3|.wav` — what narration.mjs writes. */
const CACHE_KEY_PATTERN = /^[\da-f]{64}$/;

/** What a `<key>.json` in the cache directory holds — see narration.mjs. */
interface CacheMetadata {
  provider: string;
  cacheKey: string;
  text: string;
  audioFile: string;
  durationMs?: number;
  [extra: string]: unknown;
}

/**
 * Mirrors the pipeline's content-addressed narration cache into Postgres.
 *
 * The cache is what keeps unchanged voice-over text from calling ElevenLabs
 * twice — but it lives in a directory, and a redeployed container starts with
 * an empty one, which means every redeploy re-buys the entire narration and
 * re-synthesizes audio that is *almost* identical to the last take's. The
 * table makes the cache durable: before a prepare runs, `restore()` puts every
 * known entry back on disk; after a job, `ingest()` folds whatever the
 * pipeline newly synthesized into the table.
 *
 * The pipeline itself stays file-only on purpose — it is a child process with
 * no database connection, and should not grow one. Both directions are
 * best-effort: a cache that cannot be mirrored costs money, not correctness,
 * so neither ever fails the job it runs beside.
 */
@Injectable()
export class DemoFactoryNarrationCache {
  private readonly logger = new Logger(DemoFactoryNarrationCache.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly host: DemoFactoryHost
  ) {}

  private cacheDirectory(): string {
    return path.join(this.host.cacheRoot(), 'narration');
  }

  /** Write every cached narration the directory does not already hold. */
  async restore(): Promise<void> {
    try {
      const directory = this.cacheDirectory();
      await mkdir(directory, { recursive: true });
      const present = new Set(await readdir(directory));

      const rows = await this.db.select().from(demoNarrationCache);
      let restored = 0;
      for (const row of rows) {
        const audioName = `${row.cacheKey}${row.audioExtension}`;
        if (present.has(`${row.cacheKey}.json`) && present.has(audioName)) continue;

        const audioFile = path.join(directory, audioName);
        await writeFile(audioFile, row.audio);
        // The stored metadata carries no machine paths; audioFile is this
        // machine's, stamped at restore time — the shape narration.mjs reads.
        const metadata = { ...(row.metadata as object), audioFile } as CacheMetadata;
        await writeFile(path.join(directory, `${row.cacheKey}.json`), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
        restored += 1;
      }
      if (restored > 0) this.logger.log(`Restored ${restored} narration cache entr(y/ies) from the database`);
    } catch (error) {
      this.logger.warn(`Could not restore the narration cache: ${(error as Error).message}`);
    }
  }

  /** Fold cache entries the pipeline newly wrote into the table. */
  async ingest(): Promise<void> {
    try {
      const directory = this.cacheDirectory();
      const entries = await readdir(directory).catch(() => [] as string[]);
      const keys = entries
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .filter((key) => CACHE_KEY_PATTERN.test(key));
      if (keys.length === 0) return;

      const known = new Set(
        (
          await this.db
            .select({ cacheKey: demoNarrationCache.cacheKey })
            .from(demoNarrationCache)
            .where(inArray(demoNarrationCache.cacheKey, keys))
        ).map((row) => row.cacheKey)
      );

      let ingested = 0;
      for (const key of keys) {
        if (known.has(key)) continue;
        try {
          const metadata = JSON.parse(await readFile(path.join(directory, `${key}.json`), 'utf8')) as CacheMetadata;
          const audioExtension = path.extname(metadata.audioFile || '') || '.mp3';
          const audio = await readFile(path.join(directory, `${key}${audioExtension}`));
          // Silent placeholders are not worth a row: they are cheap to
          // regenerate and would only bloat the table with zero-value WAVs.
          if (metadata.provider !== 'elevenlabs') continue;

          const { audioFile: _machinePath, ...portable } = metadata;
          await this.db
            .insert(demoNarrationCache)
            .values({
              cacheKey: key,
              provider: metadata.provider,
              voiceId: String(metadata.voiceId ?? ''),
              modelId: String(metadata.modelId ?? ''),
              languageCode: String(metadata.languageCode ?? ''),
              text: metadata.text ?? '',
              durationMs: typeof metadata.durationMs === 'number' ? Math.round(metadata.durationMs) : null,
              metadata: portable,
              audio,
              audioExtension
            })
            .onConflictDoNothing();
          ingested += 1;
        } catch (error) {
          this.logger.warn(`Skipping cache entry ${key}: ${(error as Error).message}`);
        }
      }
      if (ingested > 0) this.logger.log(`Ingested ${ingested} new narration cache entr(y/ies) into the database`);
    } catch (error) {
      this.logger.warn(`Could not ingest the narration cache: ${(error as Error).message}`);
    }
  }
}
