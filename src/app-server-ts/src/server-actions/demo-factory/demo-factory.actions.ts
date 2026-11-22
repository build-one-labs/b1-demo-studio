/* eslint-disable security/detect-non-literal-fs-filename --
 * This service exists to run the demo factory's pipeline and keep its job log,
 * so the paths it touches are built at runtime. The rule's concern —
 * attacker-controlled path traversal — is handled at the door instead: every id
 * from the browser goes through assertSafeId(), and every path through
 * safeChildPath(), which refuses anything resolving outside its configured root.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, WriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { B1Action, B1ActionPayload, B1Service } from '@buildone/app-server-tslib';
import { RequestContext, SecretResolver } from '@buildone/app-server-tslib/modules';
import { Logger } from '@nestjs/common';

import { DEMO_USER_ID_PATTERN, DemoFactoryDemoUsers, DemoUserRow, demoUserJobEnv } from './demo-factory.demo-users';
import { DemoFactoryHost } from './demo-factory.host';
import {
  assertOperator,
  assertSafeId,
  buildJobCommand,
  JobAction,
  JobCommand,
  safeChildPath,
  stageBlockedReason,
  UPLOAD_ID_PATTERN
} from './demo-factory.lib';
import { DemoFactoryMaterializer } from './demo-factory.materializer';
import { DemoFactoryNarrationCache } from './demo-factory.narration-cache';
import { DemoDocument, DemoRow, DSO, JobRow, SceneRow } from './demo-factory.rows';
import { DemoFactoryRunIngest } from './demo-factory.run-ingest';
import { DemoFactorySeedService } from './demo-factory.seed';
import { DemoFactoryStore } from './demo-factory.store';
import { DemoFactoryTransfer } from './demo-factory.transfer';

/**
 * Server actions behind the Demo Factory Studio screen.
 *
 * What is left here is what cannot be a data source: starting, watching and
 * cancelling a pipeline job. Everything the screen *shows* — demos, scenes,
 * runs, settings, the host's capabilities — is a `b1_data_source_temporary` in
 * the `b1-demo-factory` module now, read and written by the framework's own
 * data-source machinery; the services beside this file keep those in step with
 * the files the pipeline reads and writes.
 *
 * Two deliberate differences from the Studio's original standalone server:
 *
 * - **Polling, not SSE.** Upstream streams job state over `/api/events`. A B1
 *   action is a request/response endpoint, so `job` returns the same object and
 *   the screen polls it while a job runs. Same shape, one fewer transport.
 * - **The CLI owns validation.** Upstream re-parses the demo with the zod schema
 *   in-process. Importing that schema here would mean a second copy of it in a
 *   different language, free to drift; the materializer writes the file and
 *   runs `cli.mjs validate` instead. The schema stays in exactly one place.
 */

interface JobLogLine {
  at: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

interface JobState {
  id: string | null;
  action: JobAction | null;
  demoId: string | null;
  status: 'idle' | 'running' | 'complete' | 'failed' | 'cancelled';
  step: JobAction | null;
  /** The screen recording an `analyze` job turns into a demo. */
  uploadId: string | null;
  logs: JobLogLine[];
  /** Where the untruncated output of this job is being written. */
  logFile: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
}

const idleJob = (): JobState => ({
  id: null,
  action: null,
  demoId: null,
  status: 'idle',
  step: null,
  uploadId: null,
  logs: [],
  logFile: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null
});

/** Keep the tail only: a full render is chatty and the panel shows a tail anyway. */
const LOG_LIMIT = 600;

/**
 * How many job logs to keep under `<output>/logs`.
 *
 * They are small (a render writes a few hundred lines) and the reason to keep
 * more than the current one is to compare a run that worked with the one that
 * did not, so this is generous rather than tidy.
 */
const LOG_FILES_KEPT = 50;

/** What inspect-page opens and plays — see inspectRequestSchema in demo-factory/src/lib/inspect.mjs, which validates it. */
interface InspectRequest {
  url?: string;
  route?: string;
  baseUrl?: string;
  actions?: unknown[];
  assertions?: unknown[];
}

const INSPECT_TIMEOUT_MS = 180_000;

@B1Service({ basePath: 'demo-factory' })
export class DemoFactoryStudio {
  private readonly logger = new Logger(DemoFactoryStudio.name);

  constructor(
    private readonly host: DemoFactoryHost,
    private readonly store: DemoFactoryStore,
    private readonly materializer: DemoFactoryMaterializer,
    private readonly seed: DemoFactorySeedService,
    private readonly runIngest: DemoFactoryRunIngest,
    private readonly transfer: DemoFactoryTransfer,
    private readonly narrationCache: DemoFactoryNarrationCache,
    private readonly ctx: RequestContext,
    private readonly secrets: SecretResolver,
    private readonly demoUsers: DemoFactoryDemoUsers
  ) {}

  /**
   * Refuse a mutating call from an account `DEMO_FACTORY_OPERATORS` does not
   * list. Unset means open — the workspace behaviour — and on a deployed stack
   * the variable is what separates watching videos from re-recording them,
   * until platform-level Melange checks take that job over.
   */
  private assertOperator(): void {
    assertOperator((this.ctx.user as { email?: string } | undefined)?.email);
  }

  private job: JobState = idleJob();

  /** One live look at a time — each opens a browser. */
  private inspecting = false;

  /**
   * Set while a job is being started: between the "nothing is running" check
   * and launch() lie several awaits, and a second request arriving there must
   * not pass the same check (see exclusively).
   */
  private starting = false;

  /** The demo as a conversion started from it — its result is saved only onto that same state. */
  private convertBaseline: string | undefined;

  private activeChild: ReturnType<typeof spawn> | undefined;

  private jobLog: WriteStream | undefined;

  private appendLog(chunk: unknown, stream: 'stdout' | 'stderr'): void {
    const text = String(chunk).replace(/\r/g, '').trimEnd();
    if (!text) return;
    for (const line of text.split('\n')) {
      this.job.logs.push({ at: new Date().toISOString(), stream, text: line });
      this.jobLog?.write(`${new Date().toISOString()} ${stream === 'stderr' ? 'ERR' : 'out'} ${line}\n`);
    }
    this.job.logs = this.job.logs.slice(-LOG_LIMIT);
  }

  /**
   * Start writing this job's output to `<output>/logs`, alongside the tail the
   * Studio polls.
   *
   * That tail lives in this process and is capped, so a `nest --watch` restart
   * — or anything else that ends this server mid-render — takes the whole
   * record of the run with it, which is exactly when the record is wanted: what
   * a killed render leaves on disk is a run directory that simply stops, with
   * no clue whether it was bundling, rendering or already dead. The file sits on
   * the same volume as the runs, so a workspace shell can `tail -f` it while a
   * job started from the Studio screen is still going.
   */
  private async openJobLog(script: string, args: string[]): Promise<void> {
    const file = this.job.logFile;
    if (!file) return;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await this.pruneJobLogs(path.dirname(file));
      this.jobLog = createWriteStream(file, { flags: 'a' });
      this.jobLog.write(
        `# ${this.job.startedAt} ${this.job.action} ${this.job.demoId}\n# node ${script} ${args.join(' ')} (cwd ${this.host.projectRoot})\n`
      );
    } catch (error) {
      // A log that cannot be opened is not a reason to refuse to run the job.
      this.job.logFile = null;
      this.appendLog(`Could not open the job log: ${(error as Error).message}`, 'stderr');
    }
  }

  private async closeJobLog(): Promise<void> {
    const stream = this.jobLog;
    this.jobLog = undefined;
    if (!stream) return;
    await new Promise<void>((resolve) =>
      stream.end(`# ${this.job.finishedAt} ${this.job.status} (exit ${this.job.exitCode})\n`, () => resolve())
    );
  }

  private async pruneJobLogs(directory: string): Promise<void> {
    // Names are the ISO start time, so lexical order is chronological.
    const files = (await readdir(directory).catch(() => [] as string[])).filter((name) => name.endsWith('.log')).sort();
    for (const name of files.slice(0, Math.max(0, files.length - (LOG_FILES_KEPT - 1)))) {
      await rm(path.join(directory, name), { force: true });
    }
  }

  /**
   * Mirror the job into its data source — on transitions only.
   *
   * Never per log line: a clob commit rewrites the whole array, and a render
   * logs several hundred of them. The live tail stays on `jobStatus`; what the
   * data source adds is a history that survives this process, which the tail
   * does not.
   */
  private async recordJob(): Promise<void> {
    if (!this.job.id) return;
    const row: JobRow = {
      id: this.job.id,
      action: this.job.action,
      demoId: this.job.demoId,
      status: this.job.status,
      step: this.job.step,
      startedAt: this.job.startedAt,
      finishedAt: this.job.finishedAt,
      exitCode: this.job.exitCode,
      logFile: this.job.logFile
    };
    try {
      const existing = await this.store.read<JobRow>(DSO.job);
      await this.store.commit(
        DSO.job,
        existing.some((job) => job.id === row.id) ? { updatedRecords: [row] } : { createdRecords: [row] }
      );
    } catch (error) {
      // History is a nicety; the job itself must not depend on it.
      this.logger.warn(`Could not record the job: ${(error as Error).message}`);
    }
  }

  @B1Action({ description: 'The current job, after making sure the data sources match this host' })
  async state() {
    // The screen opens with this call, which makes it the first authenticated
    // moment of the process on a host with no service key — and therefore the
    // first point at which the data sources can be brought in line with this
    // host. It runs once; every later call falls straight through.
    await this.seed.ensureReconciled();
    return { job: this.job };
  }

  @B1Action({ description: 'Start a pipeline stage (validate, prepare, record, render or all)' })
  async startJob({
    body: { action = 'validate', demoId = '', scenes = [], voice, runId } = {}
  }: B1ActionPayload<{ action?: JobAction; demoId?: string; scenes?: string[]; voice?: string; runId?: string }> = {}) {
    this.assertOperator();
    if (action === 'analyze') throw new Error('Analyze an uploaded video with import-video');
    if (action === 'convert') throw new Error('Convert a video demo with convert-video');
    return this.exclusively(() => this.startStage({ action, demoId, scenes, voice, runId }));
  }

  private async startStage({
    action,
    demoId,
    scenes,
    voice,
    runId
  }: {
    action: JobAction;
    demoId: string;
    scenes: string[];
    voice?: string;
    runId?: string;
  }) {
    const command = buildJobCommand({ action, demoId, scenes, voice, runId });

    // The screen disables what this host cannot do, but it is not the only
    // caller and its capability snapshot is as old as its last fetch. Refuse
    // here too, with the reason, rather than spawn a child that cannot succeed.
    // Only the stages that open the application sign in; validate, prepare and
    // render never need the demo user, so its missing key does not stop them.
    const signIn = action === 'record' || action === 'all' ? await this.demoUserEnv(demoId) : {};
    const blocked = stageBlockedReason(action, await this.host.capabilities(), {
      filmsInBrowser: await this.filmsInBrowser(demoId),
      hasDemoUser: Boolean(signIn.DEMO_USER)
    });
    if (blocked) throw new Error(`Cannot run ${action} on this host — ${blocked}.`);

    // The demo data source is the source of truth, and the pipeline reads a
    // file — so the file is written from it here, before anything is spawned.
    // A demo that no longer validates throws out of this call rather than
    // failing three stages later inside a child process.
    await this.materializer.materializeIfPresent(demoId);

    // A prepare on a freshly deployed container starts with an empty cache
    // directory; the table remembers what was already paid for.
    if (action === 'prepare' || action === 'all') await this.narrationCache.restore();

    return this.launch(action, demoId, command, null, signIn);
  }

  /**
   * The sign-in a job of this demo gets: its demo user's key and auth-state
   * file, when `settings.demoUser` names one — otherwise nothing, and the job
   * signs in with the host's own key as before. A named user without a stored
   * key stops the job: recording as the wrong account is worse than not at all.
   */
  private async demoUserEnv(demoId: string): Promise<Record<string, string>> {
    const demo = (await this.store.read<DemoRow>(DSO.demo)).find((row) => row.id === demoId);
    const id = String((demo?.settings as { demoUser?: unknown } | undefined)?.demoUser ?? '').trim();
    if (!id) return {};
    const apiKey = await this.demoUsers.apiKey(id);
    if (!apiKey) {
      throw new Error(`Demo user "${id}" has no API key in the secret store — add it under Settings → Demo users`);
    }
    return demoUserJobEnv(id, apiKey, {
      authStateFile: path.join(this.host.projectRoot, 'playwright', '.auth', `demo-user-${id}.json`)
    });
  }

  /**
   * Whether a demo has a scene a browser must film. False only for a demo cut
   * entirely from an uploaded screen recording, whose record stage is ffmpeg.
   * An unknown demo counts as filmed — the stricter check.
   */
  private async filmsInBrowser(demoId: string): Promise<boolean> {
    const scenes = (await this.store.read<SceneRow>(DSO.scene)).filter((row) => row.demoId === demoId);
    return scenes.length === 0 || scenes.some((row) => row.mode === 'film' || (row.mode !== 'clip' && !row.clip));
  }

  /**
   * Run the start of a job alone: the check that nothing runs and the launch
   * it guards are one step for every other caller, however many awaits lie
   * between them.
   */
  private async exclusively<T>(start: () => Promise<T>): Promise<T> {
    if (this.job.status === 'running' || this.starting) throw new Error('Another job is already running');
    if (this.inspecting) throw new Error('An inspection is running — start the job when it is done');
    this.starting = true;
    try {
      return await start();
    } finally {
      this.starting = false;
    }
  }

  /** A demo's rows as they stand: the demo and its scenes, in order. */
  private async demoFingerprint(demoId: string): Promise<string> {
    const demo = (await this.store.read<DemoRow>(DSO.demo)).find((row) => row.id === demoId);
    const scenes = (await this.store.read<SceneRow>(DSO.scene))
      .filter((row) => row.demoId === demoId)
      .sort((a, b) => Number(a.sequence) - Number(b.sequence));
    return JSON.stringify({ demo, scenes });
  }

  /** Start `command` as the current job and return at once; the screen polls jobStatus. */
  private async launch(
    action: JobAction,
    demoId: string,
    command: JobCommand,
    uploadId: string | null = null,
    extraEnv: Record<string, string> = {}
  ): Promise<{ job: JobState }> {
    const startedAt = new Date().toISOString();
    this.job = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      action,
      demoId,
      status: 'running',
      step: command.step,
      uploadId,
      logs: [],
      // Named, not opened, so the first response already tells the caller where
      // to look — including the caller watching a job that this server will not
      // live long enough to report the end of.
      logFile: path.join(
        this.host.outputRoot(),
        'logs',
        `${startedAt.replace(/[.:]/g, '-')}--${demoId}--${action}.log`
      ),
      startedAt,
      finishedAt: null,
      exitCode: null
    };
    await this.recordJob();

    // Deliberately not awaited: the action returns immediately and the screen
    // polls `job`, which is what keeps a 90-second render from timing out the
    // HTTP request that started it.
    void this.execute(command.script, command.args, extraEnv);
    return { job: this.job };
  }

  private async execute(script: string, args: string[], extraEnv: Record<string, string> = {}): Promise<void> {
    await this.openJobLog(script, args);
    try {
      const child = spawn(process.execPath, [script, ...args], {
        cwd: this.host.projectRoot,
        env: { ...process.env, ...this.host.definedEnv(), ...extraEnv },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.activeChild = child;
      child.stdout?.on('data', (data) => this.appendLog(data, 'stdout'));
      child.stderr?.on('data', (data) => this.appendLog(data, 'stderr'));
      child.once('error', (error) => this.appendLog(error.stack || error.message, 'stderr'));
      const exitCode: number = await new Promise((resolve) => child.once('exit', (code) => resolve(code ?? -1)));
      this.job.exitCode = exitCode;
      // An analysis is done only when its demo exists: the screen reloads the
      // demo list the moment it sees `complete`, so the save comes first.
      // A conversion likewise: its result is a document to save.
      if (exitCode === 0 && this.job.status !== 'cancelled' && this.job.action === 'analyze')
        await this.saveJobDocument('demo.json', 'created');
      if (exitCode === 0 && this.job.status !== 'cancelled' && this.job.action === 'convert')
        await this.saveJobDocument('converted.json', 'converted');
      if (this.job.status === 'running') this.job.status = exitCode === 0 ? 'complete' : 'failed';
    } catch (error) {
      this.appendLog((error as Error).stack || (error as Error).message, 'stderr');
      this.job.status = 'failed';
      this.job.exitCode = -1;
    } finally {
      this.activeChild = undefined;
      this.job.finishedAt = new Date().toISOString();
      await this.closeJobLog();
      // Both run in the continuation of the request that started the job, so
      // they carry its credentials — a job started from the screen writes its
      // rows as the person who clicked.
      if (this.job.action !== 'analyze' && this.job.action !== 'convert') await this.ingestRun();
      await this.recordJob();
      // Whatever narration the pipeline newly synthesized becomes durable.
      if (this.job.action === 'prepare' || this.job.action === 'all') await this.narrationCache.ingest();
    }
  }

  /**
   * Fold whatever the job left on disk into the run data sources.
   *
   * Scoped to the demo that ran, and never allowed to fail the job: the run
   * happened whether or not its rows could be written, and the start-up
   * reconcile picks up anything missed here.
   */
  private async ingestRun(): Promise<void> {
    const demoId = this.job.demoId;
    if (!demoId) return;
    try {
      await this.runIngest.reconcile(demoId);
    } catch (error) {
      this.appendLog(`The run finished, but its results could not be recorded: ${(error as Error).message}`, 'stderr');
    }
  }

  /**
   * The demo an `analyze` or `convert` job wrote into its upload directory,
   * saved through the one validated write path — before the log closes, so
   * the file records whether the demo landed, and in the continuation of the
   * request that started the job, so it is written as the person who clicked.
   * A failure fails the job: the pipeline ran, but the demo did not change,
   * and that is what the person waiting needs to see.
   */
  private async saveJobDocument(
    fileName: 'demo.json' | 'converted.json',
    verb: 'created' | 'converted'
  ): Promise<void> {
    const { uploadId, demoId } = this.job;
    try {
      if (!uploadId || !demoId) throw new Error(`The ${this.job.action} job lost its upload id`);
      const file = safeChildPath(this.uploadsRoot(), uploadId, fileName);
      const document = JSON.parse(await readFile(file, 'utf8')) as DemoDocument;
      if (document.id !== demoId) throw new Error(`The job wrote demo ${document.id}, not ${demoId}`);
      // The conversion read the demo as it was when it started and wrote it
      // back whole; edits made meanwhile would be lost under it. Refuse, and
      // keep the result where it is, rather than overwrite them.
      if (verb === 'converted' && (await this.demoFingerprint(demoId)) !== this.convertBaseline) {
        throw new Error(
          `${demoId} was edited while the conversion ran, so its result was not saved over those edits. ` +
            `Run Convert again (the result is kept at ${file}).`
        );
      }
      const { scenes } = await this.transfer.saveDocument(document);
      if (verb === 'created') {
        this.appendLog(`Demo ${demoId} created with ${scenes} scene${scenes === 1 ? '' : 's'}.`, 'stdout');
      } else {
        const filmed = document.scenes.filter((scene) => scene.mode === 'film').length;
        this.appendLog(`Demo ${demoId} converted: ${filmed} of ${scenes} scenes are filmed.`, 'stdout');
      }
    } catch (error) {
      this.job.status = 'failed';
      this.appendLog(`The job ran, but the demo could not be saved: ${(error as Error).message}`, 'stderr');
    }
  }

  private uploadsRoot(): string {
    return path.join(this.host.outputRoot(), 'uploads');
  }

  /**
   * Turn an uploaded screen recording into a new demo.
   *
   * The upload itself went to `demo-factory/upload` (a multipart route — an
   * action takes JSON); this starts the `analyze` job on it. The job cuts the
   * recording into scenes and transcribes the narration, and when it exits
   * cleanly the demo is saved like any Studio edit. Refuses an existing demo
   * id rather than overwrite it: importing a video is how a demo begins.
   */
  @B1Action({ description: 'Analyze an uploaded screen recording and create a demo from it' })
  async importVideo({
    body: { uploadId = '', demoId = '', title = '', language = '' } = {}
  }: B1ActionPayload<{ uploadId?: string; demoId?: string; title?: string; language?: string }> = {}) {
    this.assertOperator();
    assertSafeId(demoId, 'demo id');
    if (!UPLOAD_ID_PATTERN.test(uploadId)) throw new Error('Upload the video first');
    return this.exclusively(() => this.startAnalysis({ uploadId, demoId, title, language }));
  }

  private async startAnalysis({
    uploadId,
    demoId,
    title,
    language
  }: {
    uploadId: string;
    demoId: string;
    title: string;
    language: string;
  }) {
    const command = buildJobCommand({
      action: 'analyze',
      demoId,
      uploadId,
      title,
      language: language.trim().toLowerCase() || undefined
    });

    if ((await this.store.read<DemoRow>(DSO.demo)).some((row) => row.id === demoId)) {
      throw new Error(`A demo with id "${demoId}" already exists — choose another id`);
    }
    await readFile(safeChildPath(this.uploadsRoot(), uploadId, 'upload.json'), 'utf8').catch(() => {
      throw new Error(`Upload ${uploadId} is not on this host — upload the video again`);
    });
    const blocked = stageBlockedReason('analyze', await this.host.capabilities());
    if (blocked) throw new Error(`Cannot analyze the video on this host — ${blocked}.`);

    return this.launch('analyze', demoId, command, uploadId);
  }

  /**
   * Turn the clip scenes of a video demo into filmed scenes: Claude reads the
   * keyframes and the narration, writes Playwright actions against the live
   * application, and a trial run proves them (demo-factory/src/lib/convert.mjs).
   * Scenes whose trial fails stay clips. The Anthropic key comes from the
   * secret store, as the person who clicked, and reaches only this child.
   */
  @B1Action({
    description: 'Convert the clip scenes of a video demo into filmed scenes (Claude + a Playwright trial run)'
  })
  async convertVideo({ body: { demoId = '' } = {} }: B1ActionPayload<{ demoId?: string }> = {}) {
    this.assertOperator();
    return this.exclusively(() => this.startConversion(demoId));
  }

  private async startConversion(demoId: string) {
    const command = buildJobCommand({ action: 'convert', demoId });
    const demo = (await this.store.read<DemoRow>(DSO.demo)).find((row) => row.id === demoId);
    if (!demo) throw new Error(`No demo ${demoId}`);
    const uploadId = demo.source?.video?.split('/')[0] ?? '';
    if (!UPLOAD_ID_PATTERN.test(uploadId))
      throw new Error(`${demoId} was not made from a screen recording — nothing to convert`);
    const signIn = await this.demoUserEnv(demoId);
    const blocked = stageBlockedReason('convert', await this.host.capabilities(), {
      hasDemoUser: Boolean(signIn.DEMO_USER)
    });
    if (blocked) throw new Error(`Cannot convert the video demo on this host — ${blocked}.`);
    const apiKey = await this.secrets.resolve('anthropic-api-key');
    if (!apiKey) throw new Error('No Anthropic API key — store the anthropic-api-key secret or set ANTHROPIC_API_KEY');
    await this.materializer.materializeIfPresent(demoId);
    this.convertBaseline = await this.demoFingerprint(demoId);
    return this.launch('convert', demoId, command, uploadId, { ...signIn, ANTHROPIC_API_KEY: apiKey });
  }

  /**
   * Add or change a demo user. The API key, when given, goes to the secret
   * store (organization level, as the caller) and nowhere else; the row keeps
   * only the id, the label and the application. An empty key leaves a stored
   * key as it is.
   */
  @B1Action({ description: 'Add or change a demo user; its API key goes to the secret store' })
  async saveDemoUser({
    body: { id = '', label = '', appUrl = '', apiKey = '' } = {}
  }: B1ActionPayload<{ id?: string; label?: string; appUrl?: string; apiKey?: string }> = {}) {
    this.assertOperator();
    const userId = id.trim();
    if (!DEMO_USER_ID_PATTERN.test(userId)) throw new Error('A demo user id is lowercase letters, digits and hyphens');
    const url = appUrl.trim();
    if (url && !/^https?:\/\/[^\s/]+/.test(url)) throw new Error('The application URL starts with https://');
    const rows = await this.store.read<DemoUserRow>(DSO.demoUser);
    const existing = rows.find((row) => row.id === userId);
    if (!existing && !apiKey.trim()) throw new Error("Paste the demo user's API key — a new demo user needs one");
    if (apiKey.trim()) await this.demoUsers.storeApiKey(userId, apiKey.trim());
    const row: DemoUserRow = {
      id: userId,
      label: label.trim() || existing?.label || userId,
      appUrl: url || existing?.appUrl || '',
      configured: false,
      updatedAt: new Date().toISOString()
    };
    await this.store.commit(DSO.demoUser, existing ? { updatedRecords: [row] } : { createdRecords: [row] });
    return { id: userId, configured: Boolean(await this.demoUsers.apiKey(userId)) };
  }

  /** Remove a demo user and its key. Demos that name it stop at their next job and say so. */
  @B1Action({ description: 'Delete a demo user and its key in the secret store' })
  async deleteDemoUser({ body: { id = '' } = {} }: B1ActionPayload<{ id?: string }> = {}) {
    this.assertOperator();
    const userId = id.trim();
    if (!DEMO_USER_ID_PATTERN.test(userId)) throw new Error('Invalid demo user id');
    await this.demoUsers.storeApiKey(userId, null);
    const row = (await this.store.read<DemoUserRow>(DSO.demoUser)).find((candidate) => candidate.id === userId);
    if (row) await this.store.commit(DSO.demoUser, { deletedRecords: [row] });
    const users = (await this.store.read<DemoRow>(DSO.demo))
      .filter((demo) => (demo.settings as { demoUser?: unknown }).demoUser === userId)
      .map((demo) => demo.id);
    return { id: userId, stillNamedBy: users };
  }

  /**
   * The live look (demo-factory/src/lib/inspect.mjs): open a page of the
   * target application signed in as this demo's takes are, optionally play
   * draft actions and assertions there, and answer with the page it ended on —
   * its ARIA snapshot, a screenshot URL and, if a step failed, why. It is how
   * an author (or the Demo Creator agent) sees the real page before filming
   * it. Waits for the result (30–90 s); never a job, so it does not disturb
   * one — but it acts in the live application as that user.
   */
  @B1Action({
    description:
      'Open a page of the target app as the demo user, optionally play draft actions, return its ARIA snapshot and screenshot'
  })
  async inspectPage({ body = {} }: B1ActionPayload<InspectRequest & { demoId?: string }> = {}) {
    this.assertOperator();
    const { demoId = '', ...request } = body;
    if (!demoId) throw new Error('Name the demo whose sign-in and base URL to use (demoId)');
    assertSafeId(demoId, 'demo id');
    if (!(await this.store.read<DemoRow>(DSO.demo)).some((row) => row.id === demoId)) {
      throw new Error(`Demo ${demoId} not found`);
    }
    if (this.inspecting) throw new Error('Another inspection is running — try again in a minute');
    if (this.job.status === 'running' || this.starting)
      throw new Error('A pipeline job is running — inspect when it is done');
    // Claimed before the first await below, so a second call cannot slip in.
    this.inspecting = true;
    try {
      return await this.runInspection(demoId, request);
    } finally {
      this.inspecting = false;
    }
  }

  private async runInspection(demoId: string, request: InspectRequest) {
    const signIn = await this.demoUserEnv(demoId);
    const blocked = stageBlockedReason('convert', await this.host.capabilities(), {
      hasDemoUser: Boolean(signIn.DEMO_USER)
    });
    if (blocked) throw new Error(`Cannot inspect on this host — ${blocked}.`);
    await this.materializer.materializeIfPresent(demoId);

    const runId = `inspect-${new Date().toISOString().replace(/[.:]/g, '-')}-${Math.random().toString(16).slice(2, 8)}`;
    const outDir = path.join(this.host.outputRoot(), demoId, runId);
    await mkdir(outDir, { recursive: true });
    const requestFile = path.join(outDir, 'request.json');
    await writeFile(requestFile, JSON.stringify(request, null, 2));
    let output = '';
    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(
        process.execPath,
        ['tools/run-demo.mjs', demoId, '--stages=inspect', `--request=${requestFile}`, `--out=${outDir}`],
        {
          cwd: this.host.projectRoot,
          env: { ...process.env, ...this.host.definedEnv(), ...signIn },
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );
      for (const stream of [child.stdout, child.stderr]) {
        stream?.on('data', (data: Buffer) => {
          output = (output + data.toString()).slice(-8000);
        });
      }
      const timer = setTimeout(() => child.kill('SIGTERM'), INSPECT_TIMEOUT_MS);
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code ?? -1);
      });
    });
    const result = await readFile(path.join(outDir, 'result.json'), 'utf8')
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .catch(() => null);
    if (!result) {
      const lines = output.trim().split('\n');
      const reason =
        lines.find((line) => /Error: Invalid inspect request/.test(line))?.replace(/^.*?Error: /, '') ??
        lines.filter((line) => /error/i.test(line)).at(-1) ??
        `exit ${exitCode}`;
      throw new Error(`The inspection did not finish — ${reason.slice(0, 600)}`);
    }
    return {
      ...result,
      signedInAs: signIn.DEMO_USER || null,
      screenshotUrl: `/service/app/demo-factory/media/${demoId}/${runId}/page.jpg`
    };
  }

  @B1Action({ description: 'Current pipeline job, including its log tail' })
  async jobStatus() {
    return this.job;
  }

  @B1Action({ description: 'Stop the running pipeline job' })
  async cancelJob() {
    this.assertOperator();
    if (this.job.status !== 'running') return this.job;
    this.job.status = 'cancelled';
    this.appendLog('Cancelled by the operator.', 'stderr');
    this.activeChild?.kill('SIGTERM');
    return this.job;
  }

  /**
   * Replace a demo with the given document, validated exactly as a Studio edit
   * would be. This is the one write path for callers that hold a whole
   * document — the Studio's import dialog, and an agent working over MCP that
   * must never edit files or raw clobs.
   */
  @B1Action({ description: 'Create or replace a demo from a full document (validated before anything lands)' })
  async saveDemo({ body: { document } = {} }: B1ActionPayload<{ document?: DemoDocument }> = {}) {
    this.assertOperator();
    if (!document || typeof document !== 'object') throw new Error('Pass the demo as `document`');
    return this.transfer.saveDocument(document);
  }

  @B1Action({ description: 'The demo as demo.yaml text — the backup and transfer format' })
  async exportDemo({ body: { demoId = '' } = {} }: B1ActionPayload<{ demoId?: string }> = {}) {
    return this.transfer.exportYaml(demoId);
  }

  /**
   * Remove a demo entirely — the only way back from a demo that must not stay,
   * including one an interrupted import left without scenes.
   */
  @B1Action({ description: 'Delete a demo with its scenes and its directory' })
  async deleteDemo({ body: { demoId = '' } = {} }: B1ActionPayload<{ demoId?: string }> = {}) {
    this.assertOperator();
    if (!demoId.trim()) throw new Error('Pass the demo id as `demoId`');
    const demos = await this.store.read<DemoRow>(DSO.demo);
    const demo = demos.find((row) => row.id === demoId.trim());
    const uploadId = demo?.source?.video?.split('/')[0];
    const uploadOf = (row: DemoRow) => row.source?.video?.split('/')[0];
    if (uploadId && this.job.status === 'running' && this.job.uploadId === uploadId) {
      throw new Error(`A ${this.job.action} job is working on this demo's recording — delete it when the job is done`);
    }
    const result = await this.transfer.deleteDemo(demoId.trim());
    // A video demo's upload is its footage — typically the largest thing the
    // factory stores. It goes with the last demo cut from it: a copy or an
    // import of the demo under another id keeps using the same recording.
    const stillUsed = demos.some((row) => row.id !== demo?.id && uploadOf(row) === uploadId);
    if (uploadId && UPLOAD_ID_PATTERN.test(uploadId) && !stillUsed) {
      await rm(safeChildPath(this.uploadsRoot(), uploadId), { recursive: true, force: true });
    }
    return result;
  }

  /**
   * The newest run of a demo, so a remote renderer can find what to fetch.
   * Read-only; the run's files themselves come through the media routes.
   */
  @B1Action({ description: 'The id of the newest run of a demo' })
  async latestRun({ body: { demoId = '' } = {} }: B1ActionPayload<{ demoId?: string }> = {}) {
    assertSafeId(demoId, 'demo id');
    const pointer = JSON.parse(
      await readFile(path.join(this.host.outputRoot(), demoId, 'latest-run.json'), 'utf8')
    ) as { runId?: string };
    if (!pointer.runId) throw new Error(`No completed prepare/record run for ${demoId}`);
    return { demoId, runId: pointer.runId };
  }

  @B1Action({
    description: 'Import a demo given as demo.yaml text (mode: fail | overwrite | copy, optional newId for copy)'
  })
  async importDemo({
    body: { yaml = '', mode, newId } = {}
  }: B1ActionPayload<{ yaml?: string; mode?: 'fail' | 'overwrite' | 'copy'; newId?: string }> = {}) {
    this.assertOperator();
    if (!yaml.trim()) throw new Error('Pass the demo.yaml text as `yaml`');
    return this.transfer.importYaml(yaml, { mode, newId });
  }

  /**
   * Turn a pasted session token into the Playwright storage state the recorder
   * signs in with — the deployed replacement for the shell-only
   * `tools/auth-from-session.mjs`. The token is written into the state file
   * (that is its whole purpose) and never logged or stored anywhere else; the
   * file lands under the output root, which on a deployment is the persistent
   * volume.
   */
  @B1Action({ description: 'Mint the Playwright auth state from a pasted b1.session_token cookie' })
  async mintAuthState({
    body: { sessionToken = '', baseUrl = '' } = {}
  }: B1ActionPayload<{ sessionToken?: string; baseUrl?: string }> = {}) {
    this.assertOperator();
    const token = sessionToken.trim();
    if (!token) throw new Error('Pass the b1.session_token cookie value as `sessionToken`');

    const targetUrl = baseUrl.trim() || this.host.setting('B1_BASE_URL');
    if (!targetUrl) throw new Error('No base URL — pass `baseUrl` or configure B1_BASE_URL in Settings');
    const target = new URL(targetUrl);
    const secure = target.protocol === 'https:';
    // A year out, matching tools/auth-from-session.mjs: the recorder only ever
    // reads this file, and a past expiry makes Playwright drop the cookie
    // silently rather than fail loudly.
    const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    const cookie = (name: string) => ({
      name,
      value: token,
      domain: target.hostname,
      path: '/',
      expires,
      httpOnly: true,
      secure,
      sameSite: 'Lax' as const
    });
    // The __Secure- prefix is only legal on a secure origin — same rule as the CLI tool.
    const cookies = secure
      ? [cookie('b1.session_token'), cookie('__Secure-b1.session_token')]
      : [cookie('b1.session_token')];

    const file = path.join(this.host.outputRoot(), 'auth', 'b1-demo-user.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({ cookies, origins: [] }, null, 2)}\n`, 'utf8');
    this.host.applySetting('B1_AUTH_STATE', file);

    this.logger.log(`Auth state minted for ${target.hostname}`);
    return { file, host: target.hostname, secure };
  }

  /**
   * Re-run the reconcile by hand.
   *
   * The same pass runs by itself at start-up (or on the first `state` call of
   * the process); this is for after a `git pull` that brought a new demo, or
   * after recording a run from a shell rather than from this screen.
   */
  @B1Action({ description: 'Reconcile the demo and run data sources with this host' })
  async reseed() {
    this.assertOperator();
    return this.seed.reseed();
  }
}
