/* eslint-disable security/detect-non-literal-fs-filename --
 * Same reasoning as demo-factory.actions.ts: this service exists to write the
 * factory's demo files, so its paths are built at runtime. Every id reaching it
 * goes through assertSafeId() and every path through safeChildPath().
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { IServerEventsHandler } from '@buildone/app-server-tslib/utils';
import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import YAML from 'yaml';

import { assertSafeId, projectRootFrom, safeChildPath } from './demo-factory.lib';
import { DemoRow, DSO, hashDocument, rowsToDemo, SceneRow } from './demo-factory.rows';
import { DemoFactoryStore } from './demo-factory.store';

/**
 * CLS key the seed service sets while it writes rows of its own.
 *
 * The same hooks fire for a server-side commit as for one from the screen, and
 * the seed's imports and syncs must not count as "edited in the Studio" — that
 * flag is what decides whether a later `demo.yaml` change may refresh the row.
 */
export const INTERNAL_WRITE = 'demo-factory:internal-write';

/**
 * Keeps `demos/<id>/demo.yaml` in step with the demo and scene data sources.
 *
 * The data sources are the source of truth for a demo, but the pipeline is a
 * separate process that reads a file — so something has to put the document on
 * disk before a stage runs, and refuse a change that would leave an unrunnable
 * demo there. That is this class, in both directions:
 *
 * - as the `serverEventsHandler` of the demo and scene data sources, it
 *   validates a pending write **before** the commit is persisted, so a rejected
 *   edit never reaches the payload at all, and writes the final document
 *   **after** a batch has landed. The old `saveDemo` action wrote the file,
 *   validated, then restored it on failure; refusing up front is the same
 *   guarantee without the window where disk and payload disagree;
 * - as a plain service, `materializeIfPresent()` is what `startJob` calls so
 *   the CLI always runs against what the Studio shows.
 *
 * The CLI stays the only validator. Re-implementing `demo-factory/src/schema.mjs`
 * in TypeScript would be a second copy of the schema, free to drift from the one
 * the pipeline actually enforces.
 */
@Injectable()
export class DemoFactoryMaterializer implements IServerEventsHandler<DemoRow | SceneRow> {
  private readonly logger = new Logger(DemoFactoryMaterializer.name);

  private readonly projectRoot = projectRootFrom(__dirname);

  private readonly demosRoot = path.join(this.projectRoot, 'demos');

  /** Demos whose deletion is cascading to their scenes right now — see onBeforeDelete. */
  private readonly deletingDemos = new Set<string>();

  constructor(
    private readonly store: DemoFactoryStore,
    private readonly cls: ClsService
  ) {}

  private get internal(): boolean {
    return this.cls.isActive() && this.cls.get(INTERNAL_WRITE) === true;
  }

  // ---- Before hooks: validate, and stamp the demo row -----------------------

  async onBeforeCreate(record: DemoRow | SceneRow): Promise<DemoRow | SceneRow> {
    return this.onBeforeUpdate(record);
  }

  /**
   * Validate the document a pending write would produce, and refuse it if the
   * pipeline would not accept it.
   *
   * The hook sees one incoming record before the payload is rewritten, so the
   * document is assembled from the stored rows with that record substituted in.
   * Throwing here aborts the whole commit.
   *
   * A demo row written from the screen is also stamped: `updatedAt` marks it as
   * edited here (which is what protects it from being overwritten by its file
   * on the next reseed) and `sourceHash` is brought up to the file this write
   * produced, so the file the Studio itself wrote is never mistaken for drift.
   */
  async onBeforeUpdate(record: DemoRow | SceneRow): Promise<DemoRow | SceneRow> {
    // The seed imports rows *from* the file, so there is nothing to write back
    // and nothing to validate — the file already is what the rows say.
    if (this.internal) return record;

    if ('sceneId' in record) {
      await this.materialize(record.demoId, record);
      return record;
    }

    const { hash } = await this.materialize(record.id, record);
    return { ...record, updatedAt: new Date().toISOString(), sourceHash: hash ?? record.sourceHash };
  }

  /**
   * Refuse a delete that would break the remaining document.
   *
   * `onBeforeDelete` and not `onAfterDelete`: the single-record delete path is
   * not wrapped in a transaction, so by the time an after-hook runs the row is
   * already gone and throwing would report an error over nothing.
   *
   * Deleting a demo row cascades: its scene rows go with it (the scene hook
   * skips validation for a demo that is on its way out — an empty demo is not
   * a valid document, and it is not meant to be one) and so does its directory,
   * because the data source is the truth and a directory nothing owns would be
   * re-imported on the next start.
   */
  async onBeforeDelete(records: (DemoRow | SceneRow)[]): Promise<void> {
    if (this.internal) return;
    const demos = records.filter((record): record is DemoRow => !('sceneId' in record));
    const scenes = records.filter((record): record is SceneRow => 'sceneId' in record);

    for (const demo of demos) {
      assertSafeId(demo.id, 'demo id');
      this.deletingDemos.add(demo.id);
      try {
        const orphaned = (await this.store.read<SceneRow>(DSO.scene)).filter((scene) => scene.demoId === demo.id);
        await this.store.commit(DSO.scene, { deletedRecords: orphaned });
        await rm(safeChildPath(this.demosRoot, demo.id), { recursive: true, force: true });
        this.logger.log(`Deleted ${demo.id} and its directory`);
      } finally {
        this.deletingDemos.delete(demo.id);
      }
    }

    for (const demoId of new Set(scenes.map((scene) => scene.demoId))) {
      if (this.deletingDemos.has(demoId)) continue;
      const removed = new Set(scenes.filter((scene) => scene.demoId === demoId).map((scene) => scene.id));
      await this.materialize(demoId, undefined, removed);
    }
  }

  // ---- After hooks: write the final document ------------------------------

  async onAfterCreate(records: (DemoRow | SceneRow)[]): Promise<void> {
    await this.afterSceneBatch(records);
  }

  async onAfterUpdate(records: (DemoRow | SceneRow)[]): Promise<void> {
    await this.afterSceneBatch(records);
  }

  async onAfterDelete(records: (DemoRow | SceneRow)[]): Promise<void> {
    await this.afterSceneBatch(records);
  }

  /**
   * After a batch of scene rows has landed, write each affected demo's file from
   * what is now stored, and bring the demo row's `sceneCount` and `sourceHash`
   * up to date.
   *
   * The before-hook sees records one at a time, so with a batch (a copied demo's
   * scenes, a reorder) the file it last validated held only the last record on
   * top of the old rows. This pass is what makes the file the whole batch.
   *
   * The demo-row update goes through the demo hook, which stamps `updatedAt` —
   * a scene edit *is* an edit of the demo, and must protect it from a reseed
   * exactly as a title change would.
   *
   * Nothing here throws: the batch is persisted, and an error now would report a
   * failure over rows that are already saved. It is logged, and the next
   * `startJob` materializes again and surfaces anything still wrong.
   */
  private async afterSceneBatch(records: (DemoRow | SceneRow)[]): Promise<void> {
    if (this.internal) return;
    const demoIds = new Set(
      records.filter((record): record is SceneRow => 'sceneId' in record).map((scene) => scene.demoId)
    );
    for (const demoId of demoIds) {
      if (this.deletingDemos.has(demoId)) continue;
      try {
        const [demos, scenes] = await Promise.all([
          this.store.read<DemoRow>(DSO.demo),
          this.store.read<SceneRow>(DSO.scene)
        ]);
        const demo = demos.find((row) => row.id === demoId);
        if (!demo) continue;
        const { hash } = await this.materialize(demoId);
        await this.store.commit(DSO.demo, {
          updatedRecords: [
            {
              ...demo,
              sceneCount: scenes.filter((scene) => scene.demoId === demoId).length,
              sourceHash: hash ?? demo.sourceHash
            }
          ]
        });
      } catch (error) {
        this.logger.warn(`Could not write ${demoId} after its scenes changed: ${(error as Error).message}`);
      }
    }
  }

  // ---- The materialization itself ------------------------------------------

  /**
   * Materialize a demo the data sources may not know about yet, and keep the
   * row's `sourceHash` honest if the file had to be rewritten.
   *
   * Returns null when there is no row for it: on a host whose seed has not run
   * the demo data source may be empty, and refusing to start a job for that
   * reason would break the screen for the sake of a step that has not happened.
   * The file on disk is then still what the pipeline gets — the old behaviour.
   */
  async materializeIfPresent(demoId: string): Promise<boolean | null> {
    const demos = await this.store.read<DemoRow>(DSO.demo);
    const demo = demos.find((row) => row.id === demoId);
    if (!demo) {
      this.logger.warn(`No demo row for ${demoId} — running against the file on disk`);
      return null;
    }
    const { written, hash } = await this.materialize(demoId);
    if (written && hash && hash !== demo.sourceHash) {
      await this.store.commit(DSO.demo, { updatedRecords: [{ ...demo, sourceHash: hash }] });
    }
    return written;
  }

  /**
   * Write `demos/<demoId>/demo.yaml` from the data sources and prove the
   * pipeline still accepts it.
   *
   * Reports whether the file was actually rewritten and the hash of what it now
   * holds. It is left alone when the document it already holds is semantically
   * identical to the one the rows describe — which is the normal case for a
   * demo nobody has edited, and the only reason its comments survive:
   * `YAML.stringify` of a parsed document drops every comment in the file, and
   * these demos carry thirty lines of them explaining why a scene is shaped the
   * way it is.
   *
   * A demo with no scenes is skipped, not written: it cannot be a valid file
   * (the schema wants at least one scene), and it is the state a demo is in for
   * the instant between its row and its first scene being created.
   */
  async materialize(
    demoId: string,
    pending?: DemoRow | SceneRow,
    removedSceneIds: Set<string> = new Set()
  ): Promise<{ written: boolean; hash: string | null }> {
    assertSafeId(demoId, 'demo id');

    const document = await this.assemble(demoId, pending, removedSceneIds);
    if (document.scenes.length === 0) return { written: false, hash: null };

    const file = safeChildPath(this.demosRoot, demoId, 'demo.yaml');
    const previous = await readFile(file, 'utf8').catch(() => null);

    if (previous !== null && this.sameDocument(previous, document)) {
      return { written: false, hash: hashDocument(previous) };
    }

    // The shipped demos bring their directory with them in the image; one
    // created or imported through the Studio exists only in the data sources
    // until this line, so `demos/<id>/` has to be made before the file can be
    // written. Without it every new demo failed here with ENOENT — including
    // the import that is meant to be the transfer format.
    const directory = path.dirname(file);
    const directoryExisted = previous !== null || (await stat(directory).then(() => true, () => false));
    await mkdir(directory, { recursive: true });

    const text = YAML.stringify(document, { lineWidth: 0 });
    await writeFile(file, text, 'utf8');

    const { code, output } = await this.runValidate(demoId);
    if (code !== 0) {
      // Put back what was there. A demo the Studio refuses to accept must not
      // be the demo the next `yarn demo:record` picks up — and a directory this
      // call created for it goes with it, so a rejected import leaves nothing.
      if (previous !== null) await writeFile(file, previous, 'utf8');
      else await rm(directoryExisted ? file : directory, { recursive: true, force: true });
      throw new Error(`The demo no longer validates:\n${output.trim()}`);
    }

    this.logger.log(`Materialized ${demoId}`);
    return { written: true, hash: hashDocument(text) };
  }

  /** The document the data sources currently describe, with a pending change applied. */
  private async assemble(
    demoId: string,
    pending?: DemoRow | SceneRow,
    removedSceneIds: Set<string> = new Set()
  ): Promise<ReturnType<typeof rowsToDemo>> {
    const [demos, scenes] = await Promise.all([
      this.store.read<DemoRow>(DSO.demo),
      this.store.read<SceneRow>(DSO.scene)
    ]);

    const pendingDemo = pending && !('sceneId' in pending) ? pending : undefined;
    const pendingScene = pending && 'sceneId' in pending ? pending : undefined;

    const demo = pendingDemo?.id === demoId ? pendingDemo : demos.find((row) => row.id === demoId);
    if (!demo) throw new Error(`Unknown demo: ${demoId}`);

    const merged = scenes.filter((scene) => scene.demoId === demoId && !removedSceneIds.has(scene.id));
    if (pendingScene && pendingScene.demoId === demoId) {
      const index = merged.findIndex((scene) => scene.id === pendingScene.id);
      if (index >= 0) merged[index] = pendingScene;
      else merged.push(pendingScene);
    }

    return rowsToDemo(demo, merged);
  }

  /**
   * Whether the file already says the same thing as `document`.
   *
   * Compared as parsed data, not as text: the file is hand-written YAML with
   * comments, its own key order and its own line wrapping, none of which
   * `YAML.stringify` reproduces. Comparing the serialized forms would report a
   * difference for every demo in the repository and rewrite them all on the
   * first job.
   */
  private sameDocument(previous: string, document: unknown): boolean {
    try {
      return JSON.stringify(sortKeys(YAML.parse(previous))) === JSON.stringify(sortKeys(document));
    } catch {
      // Unparseable YAML on disk is a file that must be replaced, not kept.
      return false;
    }
  }

  private runValidate(demoId: string): Promise<{ code: number; output: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ['src/cli.mjs', 'validate', demoId], {
        cwd: this.projectRoot,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '';
      child.stdout?.on('data', (data) => (output += String(data)));
      child.stderr?.on('data', (data) => (output += String(data)));
      child.once('error', (error) => resolve({ code: -1, output: `${output}${error.message}` }));
      child.once('exit', (code) => resolve({ code: code ?? -1, output }));
    });
  }
}

/**
 * A deep copy with every object's keys in a stable order, so two documents that
 * differ only in key order compare equal. Arrays keep their order — in a demo
 * the order of `scenes` and of a scene's `actions` is the content.
 */
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortKeys(entry)])
    );
  }
  return value;
};
