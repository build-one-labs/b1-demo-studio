/* eslint-disable security/detect-non-literal-fs-filename --
 * Same reasoning as demo-factory.actions.ts: the demo directory is walked at
 * runtime, and every path is contained by safeChildPath().
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { RequestContext } from '@buildone/app-server-tslib/modules';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import YAML from 'yaml';

import { STAGE_LABELS } from './demo-factory.host';
import {
  ALLOWED_ENV_KEYS,
  JOB_ACTIONS,
  projectRootFrom,
  safeChildPath,
  SECRET_ENV_KEYS,
  serviceApiKey
} from './demo-factory.lib';
import { INTERNAL_WRITE } from './demo-factory.materializer';
import {
  DemoRow,
  demoToRows,
  DSO,
  hashDocument,
  HostRow,
  JobRow,
  SceneRow,
  SettingRow,
  StageRow
} from './demo-factory.rows';
import { DemoFactoryRunIngest } from './demo-factory.run-ingest';
import { DemoFactoryStore } from './demo-factory.store';

import type { Request } from 'express';

/**
 * Puts the Demo Factory's data sources into a state that matches this host,
 * on every app-server start.
 *
 * This exists because "the data source is the source of truth" and "a new
 * workspace has the repository, not the database" are both true at once:
 *
 * - The blueprint database is **not** re-imported from `src/data` in a
 *   workspace (`IMPORT_DATA=false` in the workspace compose file), so a demo
 *   that arrives as a `demo.yaml` — a fresh clone, a `git pull`, a brand-new
 *   blueprint database on a deployment — has no row until something creates it.
 * - `demo-factory/output` is gitignored, so a new Codespace has none of the run
 *   directories the database still remembers.
 *
 * So this is a reconcile, not a seed. A blind re-seed would be worse than
 * nothing: the blueprint database is shared between Codespaces, and overwriting
 * every demo row from the files on disk would throw away edits made in the
 * Studio. A demo is therefore only refreshed from its file while nobody has
 * touched it here.
 *
 * It runs at start-up when this server holds a user API key of its own (see
 * `onModuleInit`), and otherwise on the first Studio request — so it covers
 * every environment the server runs in (a Codespace, a deployed container, a
 * `nest --watch` restart) rather than only the paths a devcontainer hook reaches.
 */
@Injectable()
export class DemoFactorySeedService implements OnModuleInit {
  private readonly logger = new Logger(DemoFactorySeedService.name);

  private readonly projectRoot = projectRootFrom(__dirname);

  private readonly demosRoot = path.join(this.projectRoot, 'demos');

  constructor(
    private readonly store: DemoFactoryStore,
    private readonly runIngest: DemoFactoryRunIngest,
    private readonly cls: ClsService,
    private readonly ctx: RequestContext
  ) {}

  /** Set once the reconcile has succeeded in this process. */
  private reconciled = false;

  /** The reconcile currently in flight, so concurrent callers share one pass. */
  private inFlight: Promise<unknown> | null = null;

  /**
   * Reconcile at start-up, as this server's own user.
   *
   * The blueprint repository authenticates with whatever credential the current
   * request carries, and `RequestContext` reads that from continuation-local
   * storage — so a module-init hook, which has no request, gets 401 on every
   * call. The way through is not to fake a session but to run inside a context
   * of our own: `ClsService.run` opens one, the request stored in it carries
   * `x-api-key`, and `SwatService` forwards that header on every hop exactly as
   * it would for a headless caller. The framework resolves the key to the user
   * who owns it, so the rows are written as that user — the same person the
   * recording browser is signed in as.
   *
   * The key is a *user* key (`B1_USER_API_KEY__<AUTH HOST>` in the environment,
   * else the `B1_USER_API_KEY` the provisioner writes into `.env.app-server`),
   * because the guard refuses an organization key as having no acting user.
   * With no key at all this stays quiet and `ensureReconciled` does the job on
   * the first Studio request instead.
   *
   * Not awaited: `onModuleInit` would otherwise hold the server from listening
   * while the swat server — which may still be starting — is retried.
   */
  onModuleInit(): void {
    void this.reconcileAtBoot();
  }

  private async reconcileAtBoot(): Promise<void> {
    // The auth server and the swat server start alongside this one; a cold
    // workspace can take a minute before either answers.
    const delaysMs = [5_000, 15_000, 30_000, 60_000, 120_000];

    for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
      // Resolved per attempt: on a fresh Codespace the provisioner writes the
      // key file minutes after this server first boots.
      const key = await serviceApiKey(this.projectRoot);
      if (!key) {
        this.logger.log('No user API key on this host — the data sources reconcile on the first Studio request');
        return;
      }

      try {
        await this.asServiceUser(key, () => this.ensureReconciled());
        if (this.reconciled) return;
      } catch (error) {
        this.logger.warn(`Boot reconcile attempt ${attempt + 1} failed: ${(error as Error).message}`);
      }

      const delay = delaysMs[attempt];
      if (delay === undefined) {
        this.logger.warn('Giving up on the boot reconcile — it will run on the first Studio request');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delay).unref());
    }
  }

  /**
   * Run `work` inside a request context that authenticates with `key`.
   *
   * Only `headers` is set on the synthetic request: `RequestContext` reads
   * everything else (`cookies`, `user`, `session`) with optional chaining, and
   * the API-key path needs nothing but the header.
   */
  private asServiceUser<T>(key: string, work: () => Promise<T>): Promise<T> {
    return this.cls.run(async () => {
      this.ctx.req = { headers: { 'x-api-key': key } } as unknown as Request;
      return work();
    });
  }

  /**
   * Reconcile once per server process, if the boot pass has not already.
   *
   * The Studio screen opens by calling `state`, so on a host with no service
   * key the demos are imported and the stale runs dropped before anything is
   * rendered — the same guarantee as the boot pass, moved to the first moment
   * a caller's own session can authenticate it.
   */
  async ensureReconciled(): Promise<void> {
    if (this.reconciled) return;

    this.inFlight ??= this.reconcile()
      .then(() => {
        this.reconciled = true;
      })
      .catch((error: Error) => {
        // Never fail the request that happened to trigger it: the Studio is
        // still usable with whatever the data sources already held, and the
        // next call retries because the latch is cleared below.
        this.logger.warn(`Could not reconcile the Demo Factory data sources: ${error.message}`);
      })
      .finally(() => {
        this.inFlight = null;
      });

    await this.inFlight;
  }

  /** Force a fresh pass, whatever has run before. Backs the `reseed` action. */
  async reseed(): Promise<{ demos: number; scenes: number; runs: number }> {
    this.reconciled = false;
    return this.reconcile();
  }

  /** Demos from disk, runs from disk, the shape rows, and no job left claiming to be running. */
  async reconcile(): Promise<{ demos: number; scenes: number; runs: number }> {
    return this.asInternalWrite(async () => {
      const { demos, scenes } = await this.reconcileDemos();
      const { runs } = await this.runIngest.reconcile();
      await this.ensureShapeRows();
      await this.closeOrphanedJobs();

      this.logger.log(`Demo Factory ready: ${demos} demo(s), ${scenes} scene(s), ${runs} run(s)`);
      return { demos, scenes, runs };
    });
  }

  /**
   * Mark everything `work` writes as the seed's own.
   *
   * The materializer's hooks fire for these commits exactly as for a commit
   * from the screen, and must know the difference: an import is not an edit,
   * and a row imported from a file must not be stamped as "edited in the
   * Studio" — that stamp is what later protects it from being refreshed by
   * that same file. Scoped to the continuation, so a request that happens to
   * trigger the reconcile carries the mark only while it runs.
   */
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

  /**
   * The settings, stage and host data sources hold shape rows — one per allowed
   * key, one per stage, one host — that their handlers fill in on every read.
   * Make sure the shape is there; the values never live in the payload.
   */
  private async ensureShapeRows(): Promise<void> {
    const [settings, stages, hosts] = await Promise.all([
      this.store.read<SettingRow>(DSO.setting),
      this.store.read<StageRow>(DSO.stage),
      this.store.read<HostRow>(DSO.host)
    ]);

    const settingKeys = new Set(settings.map((row) => row.key));
    await this.store.commit(DSO.setting, {
      createdRecords: ALLOWED_ENV_KEYS.filter((key) => !settingKeys.has(key)).map((key, index) => ({
        key,
        label: key,
        value: '',
        configured: false,
        secret: SECRET_ENV_KEYS.has(key),
        source: 'unset' as const,
        sequence: ALLOWED_ENV_KEYS.indexOf(key) + 1 || index + 1
      }))
    });

    const stageIds = new Set(stages.map((row) => row.id));
    await this.store.commit(DSO.stage, {
      createdRecords: JOB_ACTIONS.filter((id) => !stageIds.has(id)).map((id) => ({
        id,
        label: STAGE_LABELS[id].label,
        hint: STAGE_LABELS[id].hint,
        sequence: JOB_ACTIONS.indexOf(id) + 1,
        allowed: false,
        blockedReason: ''
      }))
    });

    if (!hosts.some((row) => row.id === 'host')) {
      await this.store.commit(DSO.host, {
        createdRecords: [
          {
            id: 'host' as const,
            pipelineRoot: '',
            hasFactory: false,
            hasDependencies: false,
            canRecord: false,
            canRender: false,
            canAuthenticate: false
          }
        ]
      });
    }
  }

  /**
   * Create a row for every `demos/<id>/demo.yaml` that has none, and refresh
   * the ones nobody has edited here.
   *
   * The three cases, decided per demo:
   *
   * - **no row** — the file is the only thing that knows about this demo, so it
   *   is imported whole. This is the fresh-database / new-demo case;
   * - **row matches the file's hash** — nothing to do;
   * - **row differs from the file** — the file moved on. If the row was never
   *   written through the Studio (`updatedAt` is null) the file wins, because
   *   the row is just a stale import of it. If it *was* edited here, the row
   *   wins and is flagged `driftedFromFile`, so the screen can offer to reload
   *   rather than silently discarding somebody's work.
   *
   * Demos with a row but no file are left alone: a workspace that has not
   * checked out a demo's file is not a reason to delete the demo.
   */
  private async reconcileDemos(): Promise<{ demos: number; scenes: number }> {
    const [existingDemos, existingScenes] = await Promise.all([
      this.store.read<DemoRow>(DSO.demo),
      this.store.read<SceneRow>(DSO.scene)
    ]);
    const byId = new Map(existingDemos.map((row) => [row.id, row]));

    const createdDemos: DemoRow[] = [];
    const updatedDemos: DemoRow[] = [];
    const sceneRows: SceneRow[] = [];
    const refreshedDemoIds = new Set<string>();

    for (const { id, document, raw } of await this.readDemoFiles()) {
      const hash = hashDocument(raw);
      const current = byId.get(id);

      if (current && current.sourceHash === hash) continue;

      if (current && current.updatedAt !== null) {
        if (!current.driftedFromFile) {
          updatedDemos.push({ ...current, driftedFromFile: true });
          this.logger.warn(`${id} was edited in the Studio and its demo.yaml has changed — keeping the Studio version`);
        }
        continue;
      }

      const rows = demoToRows(document, hash);
      if (current) updatedDemos.push({ ...rows.demo, updatedAt: current.updatedAt });
      else createdDemos.push(rows.demo);
      sceneRows.push(...rows.scenes);
      refreshedDemoIds.add(id);
    }

    await this.store.commit(DSO.demo, { createdRecords: createdDemos, updatedRecords: updatedDemos });

    if (refreshedDemoIds.size > 0) {
      // Scene rows are replaced wholesale for a refreshed demo, never merged:
      // a scene removed from the file has to disappear here too, and matching
      // by key alone would leave it behind forever.
      const present = new Set(existingScenes.map((row) => row.id));
      await this.store.commit(DSO.scene, {
        createdRecords: sceneRows.filter((row) => !present.has(row.id)),
        updatedRecords: sceneRows.filter((row) => present.has(row.id)),
        deletedRecords: existingScenes.filter(
          (row) => refreshedDemoIds.has(row.demoId) && !sceneRows.some((wanted) => wanted.id === row.id)
        )
      });
    }

    return { demos: createdDemos.length + updatedDemos.length, scenes: sceneRows.length };
  }

  /**
   * A job row still marked running belongs to a process that no longer exists —
   * this server has only just started. Left alone it makes the Studio show a
   * phantom job and refuse to start a new one.
   */
  private async closeOrphanedJobs(): Promise<void> {
    const jobs = await this.store.read<JobRow>(DSO.job);
    const stranded = jobs.filter((job) => job.status === 'running');
    if (stranded.length === 0) return;

    await this.store.commit(DSO.job, {
      updatedRecords: stranded.map((job) => ({
        ...job,
        status: 'failed',
        finishedAt: job.finishedAt ?? new Date().toISOString(),
        exitCode: null
      }))
    });
    this.logger.warn(`Closed ${stranded.length} job(s) left running by a previous process`);
  }

  /** Every readable demo document in the repository. */
  private async readDemoFiles(): Promise<{ id: string; document: Parameters<typeof demoToRows>[0]; raw: string }[]> {
    const entries = await readdir(this.demosRoot, { withFileTypes: true }).catch(() => []);
    const files = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readFile(safeChildPath(this.demosRoot, entry.name, 'demo.yaml'), 'utf8');
        const document = YAML.parse(raw);
        // A document whose id does not name its directory would materialize
        // into the wrong file later; the pipeline resolves a demo by directory.
        if (document?.id !== entry.name) {
          this.logger.warn(`Skipping ${entry.name}: its demo.yaml declares id "${document?.id}"`);
          continue;
        }
        files.push({ id: entry.name, document, raw });
      } catch (error) {
        // A demo that does not parse is the operator's problem to fix in the
        // file; importing a broken document would only move the problem.
        this.logger.warn(`Skipping ${entry.name}: ${(error as Error).message}`);
      }
    }
    return files;
  }
}
