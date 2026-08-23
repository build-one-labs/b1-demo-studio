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
import { RequestContext } from '@buildone/app-server-tslib/modules';
import { Logger } from '@nestjs/common';

import { DemoFactoryHost } from './demo-factory.host';
import { assertOperator, assertSafeId, buildJobCommand, JobAction, stageBlockedReason } from './demo-factory.lib';
import { DemoFactoryMaterializer } from './demo-factory.materializer';
import { DemoFactoryNarrationCache } from './demo-factory.narration-cache';
import { DemoDocument, DSO, JobRow } from './demo-factory.rows';
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
    private readonly ctx: RequestContext
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
    body: { action = 'validate', demoId = '', scenes = [], voice } = {}
  }: B1ActionPayload<{ action?: JobAction; demoId?: string; scenes?: string[]; voice?: string }> = {}) {
    this.assertOperator();
    if (this.job.status === 'running') throw new Error('Another job is already running');
    const command = buildJobCommand({ action, demoId, scenes, voice });

    // The screen disables what this host cannot do, but it is not the only
    // caller and its capability snapshot is as old as its last fetch. Refuse
    // here too, with the reason, rather than spawn a child that cannot succeed.
    const blocked = stageBlockedReason(action, await this.host.capabilities());
    if (blocked) throw new Error(`Cannot run ${action} on this host — ${blocked}.`);

    // The demo data source is the source of truth, and the pipeline reads a
    // file — so the file is written from it here, before anything is spawned.
    // A demo that no longer validates throws out of this call rather than
    // failing three stages later inside a child process.
    await this.materializer.materializeIfPresent(demoId);

    // A prepare on a freshly deployed container starts with an empty cache
    // directory; the table remembers what was already paid for.
    if (action === 'prepare' || action === 'all') await this.narrationCache.restore();

    const startedAt = new Date().toISOString();
    this.job = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      action,
      demoId,
      status: 'running',
      step: command.step,
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
    void this.execute(command.script, command.args);
    return { job: this.job };
  }

  private async execute(script: string, args: string[]): Promise<void> {
    await this.openJobLog(script, args);
    try {
      const child = spawn(process.execPath, [script, ...args], {
        cwd: this.host.projectRoot,
        env: { ...process.env, ...this.host.definedEnv() },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.activeChild = child;
      child.stdout?.on('data', (data) => this.appendLog(data, 'stdout'));
      child.stderr?.on('data', (data) => this.appendLog(data, 'stderr'));
      child.once('error', (error) => this.appendLog(error.stack || error.message, 'stderr'));
      const exitCode: number = await new Promise((resolve) => child.once('exit', (code) => resolve(code ?? -1)));
      if (this.job.status !== 'cancelled') this.job.status = exitCode === 0 ? 'complete' : 'failed';
      this.job.exitCode = exitCode;
    } catch (error) {
      this.appendLog((error as Error).stack || (error as Error).message, 'stderr');
      this.job.status = 'failed';
      this.job.exitCode = -1;
    } finally {
      this.job.finishedAt = new Date().toISOString();
      this.activeChild = undefined;
      await this.closeJobLog();
      // Both run in the continuation of the request that started the job, so
      // they carry its credentials — a job started from the screen writes its
      // rows as the person who clicked.
      await this.ingestRun();
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
