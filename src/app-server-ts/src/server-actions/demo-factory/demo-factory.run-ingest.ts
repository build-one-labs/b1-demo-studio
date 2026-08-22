/* eslint-disable security/detect-non-literal-fs-filename --
 * Same reasoning as demo-factory.actions.ts: this service reads the run
 * directories, so its paths are built at runtime and contained by
 * safeChildPath() rather than by a literal.
 */
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { DRIZZLE } from '@buildone/app-server-tslib/drizzle';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { demoRunManifests } from 'src/drizzle/schema';

import { DemoFactoryHost } from './demo-factory.host';
import { safeChildPath } from './demo-factory.lib';
import { CaptionRow, DSO, manifestToRows, NarrationRow, RunManifest, RunRow, RunSceneRow } from './demo-factory.rows';
import { DemoFactoryStore, diffRows } from './demo-factory.store';

import type * as schema from 'src/drizzle/schema';

/**
 * Brings the run data sources in line with what is actually on disk.
 *
 * The pipeline writes its results as files from a child process — it has no
 * connection to the blueprint repository and should not grow one. So the runs a
 * demo has are always *derived* from `demo-factory/output`, and this service is
 * the single derivation, used from two places:
 *
 * - after a job finishes, for the demo that ran;
 * - on every app-server start, for everything.
 *
 * That second use is what makes a new Codespace correct. `demo-factory/output`
 * is gitignored, so a fresh workspace has no run directories at all while the
 * blueprint database — shared across Codespaces — still lists the runs of the
 * machine that recorded them. Without this pass the Runs view would offer videos
 * that 404. Reconciling in both directions means a row exists exactly when its
 * run directory does.
 */
@Injectable()
export class DemoFactoryRunIngest {
  private readonly logger = new Logger(DemoFactoryRunIngest.name);

  constructor(
    private readonly store: DemoFactoryStore,
    private readonly host: DemoFactoryHost,
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>
  ) {}

  /**
   * Where the runs live.
   *
   * Resolve through the host settings service, just like the child process and
   * media controller. This includes a value entered in the Studio as well as
   * provisioned and process-environment values.
   */
  private outputRoot(): string {
    return this.host.outputRoot();
  }

  private async exists(file: string): Promise<boolean> {
    return access(file).then(
      () => true,
      () => false
    );
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  /**
   * Rebuild the run data sources from disk.
   *
   * With no `demoId` every demo is reconciled and the row sets end up holding
   * exactly the runs present on this host. With one, only that demo's runs are
   * touched — the rows of every other demo are left where they are, so a job
   * finishing cannot delete the history of a demo it never ran.
   */
  async reconcile(demoId?: string): Promise<{ runs: number }> {
    const root = this.outputRoot();
    if (!(await this.exists(root))) {
      this.logger.log('No output directory on this host — the run data sources will be emptied');
    }

    const demoIds = demoId ? [demoId] : await this.demoDirectories(root);

    const runs: RunRow[] = [];
    const scenes: RunSceneRow[] = [];
    const narration: NarrationRow[] = [];
    const captions: CaptionRow[] = [];

    for (const id of demoIds) {
      for (const rows of await this.readDemoRuns(root, id)) {
        runs.push(rows.run);
        scenes.push(...rows.scenes);
        narration.push(...rows.narration);
        captions.push(...rows.captions);
      }
    }

    const scope = (row: { demoId: string }): boolean => !demoId || row.demoId === demoId;
    await this.replaceScoped(DSO.run, runs, (row) => row.runId, scope);
    await this.replaceScoped(DSO.runScene, scenes, (row) => row.id, scope);
    await this.replaceScoped(DSO.narration, narration, (row) => row.id, scope);
    await this.replaceScoped(DSO.caption, captions, (row) => row.id, scope);

    this.logger.log(`Reconciled ${runs.length} run(s)${demoId ? ` for ${demoId}` : ''}`);
    return { runs: runs.length };
  }

  /**
   * Replace only the rows this pass is responsible for.
   *
   * `DemoFactoryStore.replaceAll` would delete every row it was not given,
   * which is right for a full reconcile and wrong for a single demo — hence the
   * `scope` predicate deciding which existing rows are in play.
   */
  private async replaceScoped<T extends { demoId: string }>(
    dataSourceName: string,
    rows: T[],
    key: (row: T) => string,
    // Not `(row: T) => boolean`: that makes `scope` an inference site for T, and
    // the widest candidate — `{ demoId: string }` — wins over the row type.
    scope: (row: { demoId: string }) => boolean
  ): Promise<void> {
    const existing = await this.store.read<T>(dataSourceName);
    const inScope = existing.filter((row) => scope(row));
    await this.store.commit(dataSourceName, diffRows(inScope, rows, key));
  }

  private async demoDirectories(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    // `logs/` sits beside the demo directories and holds job transcripts, not runs.
    return entries.filter((entry) => entry.isDirectory() && entry.name !== 'logs').map((entry) => entry.name);
  }

  /** Every run directory of one demo, newest first, as rows. */
  private async readDemoRuns(root: string, demoId: string): Promise<ReturnType<typeof manifestToRows>[]> {
    const demoRoot = safeChildPath(root, demoId);
    if (!(await this.exists(demoRoot))) return [];

    const entries = await readdir(demoRoot, { withFileTypes: true }).catch(() => []);
    const runIds = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));

    const rows = [];
    for (const runId of runIds) {
      const runDir = safeChildPath(demoRoot, runId);
      const manifest = await this.readJson<RunManifest>(path.join(runDir, 'run-manifest.json'));
      // A directory with no manifest is a run that died before it recorded
      // anything. There is nothing to show for it, so it gets no row.
      if (!manifest) continue;

      const result = await this.readJson<{ totalDurationMs?: number }>(path.join(runDir, 'render-result.json'));
      await this.persistManifest(demoId, runId, manifest);
      rows.push(
        manifestToRows(manifest, {
          demoId,
          runId,
          hasVideo: await this.exists(path.join(runDir, `${demoId}.mp4`)),
          durationMs: result?.totalDurationMs || null
        })
      );
    }
    return rows;
  }

  /**
   * Keep the manifest in Postgres, beside the derived rows.
   *
   * The rows above exist exactly as long as the run directory does — that is
   * their contract. The manifest row is the part worth keeping longer: a run
   * whose media is gone still has its narration text, cue timing and cut data,
   * which is everything about the take that is reconstructible at all.
   * Best-effort, like the narration cache: a manifest that cannot be persisted
   * costs history, not the run.
   */
  private async persistManifest(demoId: string, runId: string, manifest: RunManifest): Promise<void> {
    try {
      await this.db
        .insert(demoRunManifests)
        .values({ runId, demoId, manifest })
        .onConflictDoUpdate({ target: demoRunManifests.runId, set: { manifest } });
    } catch (error) {
      this.logger.warn(`Could not persist the manifest of ${runId}: ${(error as Error).message}`);
    }
  }
}
