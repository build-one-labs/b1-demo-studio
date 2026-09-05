/* eslint-disable security/detect-non-literal-fs-filename --
 * Same reasoning as the materializer: the one path read here is the demo's own
 * materialized file, contained by safeChildPath().
 */
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import YAML from 'yaml';

import { assertSafeId, projectRootFrom, safeChildPath } from './demo-factory.lib';
import { INTERNAL_WRITE } from './demo-factory.materializer';
import { DemoDocument, DemoRow, demoToRows, DSO, rowsToDemo, SceneRow } from './demo-factory.rows';
import { DemoFactoryStore } from './demo-factory.store';

/**
 * Demos in and out of this host as documents — the YAML a `demo.yaml` holds —
 * without git and without a shell.
 *
 * Three consumers, one write path:
 *
 * - the Studio's Export/Import buttons;
 * - the `saveDemo` action, which is what an MCP agent calls instead of editing
 *   files (a whole document in, validated rows out);
 * - anyone moving a demo between environments, for whom the exported YAML is
 *   both the backup format and the transfer format.
 *
 * Every write goes through the store, whose commits fire the materializer's
 * server-event hooks — materialize, `cli.mjs validate`, refuse on failure. This
 * service never validates on its own and never writes a file itself; the one
 * schema in `demo-factory/src/schema.mjs` stays the only authority, exactly as
 * it is for a commit from the screen.
 */
@Injectable()
export class DemoFactoryTransfer {
  private readonly logger = new Logger(DemoFactoryTransfer.name);

  private readonly projectRoot = projectRootFrom(__dirname);

  private readonly demosRoot = path.join(this.projectRoot, 'demos');

  constructor(
    private readonly store: DemoFactoryStore,
    private readonly cls: ClsService
  ) {}

  /**
   * The demo as YAML.
   *
   * Preferring the materialized file over a fresh `YAML.stringify` is what
   * keeps hand-written comments in an export: the materializer leaves the file
   * untouched while it is semantically identical to the rows, so when the two
   * still agree, the file — comments and all — is the better artifact.
   */
  async exportYaml(demoId: string): Promise<{ yaml: string; filename: string }> {
    assertSafeId(demoId, 'demo id');
    const document = await this.assembleDocument(demoId);

    const file = safeChildPath(this.demosRoot, demoId, 'demo.yaml');
    const onDisk = await readFile(file, 'utf8').catch(() => null);
    if (onDisk !== null && this.sameDocument(onDisk, document)) {
      return { yaml: onDisk, filename: `${demoId}.demo.yaml` };
    }
    return { yaml: YAML.stringify(document, { lineWidth: 0 }), filename: `${demoId}.demo.yaml` };
  }

  /**
   * Import a document given as YAML text.
   *
   * `overwrite` replaces a demo of the same id; `copy` imports under `newId`
   * (falling back to `<id>-copy`); the default refuses a collision so an
   * accidental double-import cannot silently replace anything.
   */
  async importYaml(
    yaml: string,
    options: { mode?: 'fail' | 'overwrite' | 'copy'; newId?: string } = {}
  ): Promise<{ demoId: string; scenes: number; replaced: boolean }> {
    let parsed: unknown;
    try {
      parsed = YAML.parse(yaml);
    } catch (error) {
      throw new Error(`Not parseable as YAML: ${(error as Error).message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('The document must be a YAML mapping with id, title, settings and scenes');
    }

    const document = parsed as DemoDocument;
    const mode = options.mode ?? 'fail';
    if (mode === 'copy') {
      document.id = options.newId || `${document.id}-copy`;
    }
    assertSafeId(document.id, 'demo id');

    const exists = (await this.store.read<DemoRow>(DSO.demo)).some((row) => row.id === document.id);
    if (exists && mode === 'fail') {
      throw new Error(`A demo with id "${document.id}" already exists — import with mode "overwrite" or "copy"`);
    }
    if (!exists && mode === 'overwrite') {
      // Nothing to overwrite is not an error; it is a plain import.
    }

    const { scenes } = await this.saveDocument(document);
    return { demoId: document.id, scenes, replaced: exists };
  }

  /**
   * Make the data sources hold exactly `document`.
   *
   * Commit order is what keeps every intermediate state valid for the
   * materializer's per-record hooks:
   *
   * 1. the demo row — first, because a scene of a demo the store does not know
   *    cannot be assembled into a document to validate;
   * 2. scene creates and updates — the document only ever grows or changes
   *    here, and a grown document validates on its own;
   * 3. scene deletes — last, when the replacement scenes are already in place,
   *    so the remaining document is the intended one.
   */
  async saveDocument(document: DemoDocument): Promise<{ demoId: string; scenes: number }> {
    assertSafeId(document.id, 'demo id');
    const rows = demoToRows(document);

    const [demos, scenes] = await Promise.all([
      this.store.read<DemoRow>(DSO.demo),
      this.store.read<SceneRow>(DSO.scene)
    ]);
    const existingDemo = demos.find((row) => row.id === document.id);
    const existingScenes = scenes.filter((row) => row.demoId === document.id);
    const existingSceneIds = new Set(existingScenes.map((row) => row.id));
    const wantedSceneIds = new Set(rows.scenes.map((row) => row.id));

    // Carry the row's bookkeeping fields over: the materializer's own hook
    // stamps updatedAt and sourceHash on this very write, and sceneCount is
    // brought up to date by its after-batch pass.
    const demoRow: DemoRow = existingDemo
      ? {
          ...existingDemo,
          title: rows.demo.title,
          description: rows.demo.description,
          schemaVersion: rows.demo.schemaVersion,
          settings: rows.demo.settings,
          setup: rows.demo.setup,
          sceneCount: rows.demo.sceneCount
        }
      : rows.demo;
    await this.store.commit(DSO.demo, existingDemo ? { updatedRecords: [demoRow] } : { createdRecords: [demoRow] });

    // From here the demo row is already in the store, so a scene commit that
    // throws would leave a demo without scenes behind. That is not merely
    // incomplete: it can never validate or run, and `reconcileDemos` reads its
    // `updatedAt` as a Studio edit and keeps it in front of the demo.yaml it
    // shadows — so an import that failed once would go on hiding the file it
    // was importing. Undo the row instead and let the caller see the error.
    let removed: SceneRow[] = [];
    try {
      await this.store.commit(DSO.scene, {
        createdRecords: rows.scenes.filter((row) => !existingSceneIds.has(row.id)),
        updatedRecords: rows.scenes.filter((row) => existingSceneIds.has(row.id))
      });
      removed = existingScenes.filter((row) => !wantedSceneIds.has(row.id));
      if (removed.length > 0) await this.store.commit(DSO.scene, { deletedRecords: removed });
    } catch (error) {
      await this.undoDemoRow(demoRow, existingDemo).catch((undoError: unknown) => {
        // Reported, not thrown: the original failure is the one worth raising.
        this.logger.error(`Could not undo the demo row for ${document.id}: ${String(undoError)}`);
      });
      throw error;
    }

    this.logger.log(`Saved ${document.id}: ${rows.scenes.length} scene(s), ${removed.length} removed`);
    return { demoId: document.id, scenes: rows.scenes.length };
  }

  /**
   * Put the demo row back the way it was before {@link saveDocument} touched it.
   *
   * Deleting is enough for a demo that did not exist: the materializer's delete
   * hook takes any scene rows that did land, and the directory, with it.
   */
  private async undoDemoRow(written: DemoRow, previous: DemoRow | undefined): Promise<void> {
    if (previous) await this.store.commit(DSO.demo, { updatedRecords: [previous] });
    else await this.store.commit(DSO.demo, { deletedRecords: [written] });
  }

  /**
   * Delete a demo: its row, its scene rows and its directory.
   *
   * The cascade is spelled out here rather than left to the materializer's
   * delete hook. That hook runs for a delete that arrives over the data-source
   * route; a commit made in-process, as this one is, has been seen to leave the
   * scene rows and the directory behind — and a directory nothing owns is
   * re-imported as a demo on the next start. So whatever the hook did or did not
   * do, what remains is removed here, marked as an internal write so the
   * materializer does not try to re-validate a demo that is on its way out.
   *
   * Deleting a demo that is not there is not an error — the caller wanted it
   * gone, and it is; leftovers of an earlier, partial delete go with it.
   */
  async deleteDemo(demoId: string): Promise<{ demoId: string; existed: boolean }> {
    assertSafeId(demoId, 'demo id');
    const demo = (await this.store.read<DemoRow>(DSO.demo)).find((row) => row.id === demoId);

    if (demo) await this.store.commit(DSO.demo, { deletedRecords: [demo] });

    const orphaned = (await this.store.read<SceneRow>(DSO.scene)).filter((row) => row.demoId === demoId);
    if (orphaned.length > 0) {
      await this.asInternalWrite(() => this.store.commit(DSO.scene, { deletedRecords: orphaned }));
    }
    await rm(safeChildPath(this.demosRoot, demoId), { recursive: true, force: true });

    if (demo) this.logger.log(`Deleted ${demoId} with ${orphaned.length} scene(s) and its directory`);
    return { demoId, existed: Boolean(demo) };
  }

  /** Mark everything `work` writes as the server's own — see DemoFactorySeedService.asInternalWrite. */
  private async asInternalWrite<T>(work: () => Promise<T>): Promise<T> {
    if (!this.cls.isActive()) return work();
    const previous: unknown = this.cls.get(INTERNAL_WRITE);
    this.cls.set(INTERNAL_WRITE, true);
    try {
      return await work();
    } finally {
      this.cls.set(INTERNAL_WRITE, previous);
    }
  }

  private async assembleDocument(demoId: string): Promise<DemoDocument> {
    const [demos, scenes] = await Promise.all([
      this.store.read<DemoRow>(DSO.demo),
      this.store.read<SceneRow>(DSO.scene)
    ]);
    const demo = demos.find((row) => row.id === demoId);
    if (!demo) throw new Error(`Unknown demo: ${demoId}`);
    return rowsToDemo(demo, scenes);
  }

  /** Same rule as the materializer: compared as data, so comments and key order do not count. */
  private sameDocument(previous: string, document: unknown): boolean {
    try {
      return JSON.stringify(sortKeys(YAML.parse(previous))) === JSON.stringify(sortKeys(document));
    } catch {
      return false;
    }
  }
}

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
