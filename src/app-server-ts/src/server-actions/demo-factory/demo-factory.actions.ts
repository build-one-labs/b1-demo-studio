/* eslint-disable security/detect-non-literal-fs-filename --
 * This service exists to read and write the demo factory's files, so every path
 * it touches is built at runtime. The rule's concern — attacker-controlled path
 * traversal — is handled at the door instead: every id from the browser goes
 * through assertSafeId(), and every path through safeChildPath(), which refuses
 * anything resolving outside its configured root. Disabling per line would put
 * ten copies of that sentence in the file.
 */
import { spawn } from 'node:child_process';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { B1Action, B1ActionPayload, B1Service } from '@buildone/app-server-tslib';
import YAML from 'yaml';

import {
  ALLOWED_ENV_KEYS,
  assertSafeId,
  buildJobCommand,
  JobAction,
  publicSettings,
  safeChildPath,
  SECRET_ENV_KEYS
} from './demo-factory.lib';

/**
 * Server actions behind the Demo Factory Studio screen.
 *
 * These are the upstream Studio server (`src/demo-factory/studio/server.mjs`)
 * expressed as B1 actions, so the dashboard is part of the application instead
 * of a second web server the operator has to start by hand.
 *
 * Two deliberate differences from upstream:
 *
 * - **Polling, not SSE.** Upstream streams job state over `/api/events`. A B1
 *   action is a request/response endpoint, so `job` returns the same object and
 *   the screen polls it while a job runs. Same shape, one fewer transport.
 * - **The CLI owns validation.** Upstream re-parses the demo with the zod schema
 *   in-process. Importing that schema here would mean a second copy of it in a
 *   different language, free to drift; instead `saveDemo` writes the file, runs
 *   `cli.mjs validate`, and restores the previous contents if it fails. The
 *   schema stays in exactly one place.
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
  startedAt: null,
  finishedAt: null,
  exitCode: null
});

/** Keep the tail only: a full render is chatty and the panel shows a tail anyway. */
const LOG_LIMIT = 600;

@B1Service({ basePath: 'demo-factory' })
export class DemoFactoryStudio {
  /**
   * The vendored pipeline. The app server's working directory is
   * `<repo>/src/app-server-ts`, so its sibling is the default; the env var
   * exists for deployments that mount the factory somewhere else.
   */
  private readonly projectRoot = process.env.DEMO_FACTORY_ROOT || path.resolve(process.cwd(), '..', 'demo-factory');

  private readonly demosRoot = path.join(this.projectRoot, 'demos');

  /**
   * Settings live in this process, exactly as upstream keeps them in the Studio
   * server: they carry an ElevenLabs key, and writing that into demo YAML or
   * handing it back to a browser would leak it.
   */
  private runtimeEnv: Record<string, string> = Object.fromEntries(
    ALLOWED_ENV_KEYS.map((key) => [key, process.env[key] || ''])
  );

  private job: JobState = idleJob();

  private activeChild: ReturnType<typeof spawn> | undefined;

  private outputRoot(): string {
    const configured = this.runtimeEnv.DEMO_OUTPUT_DIR || process.env.DEMO_OUTPUT_DIR;
    return configured ? path.resolve(this.projectRoot, configured) : path.join(this.projectRoot, 'output');
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

  private appendLog(chunk: unknown, stream: 'stdout' | 'stderr'): void {
    const text = String(chunk).replace(/\r/g, '').trimEnd();
    if (!text) return;
    for (const line of text.split('\n')) this.job.logs.push({ at: new Date().toISOString(), stream, text: line });
    this.job.logs = this.job.logs.slice(-LOG_LIMIT);
  }

  private async listDemos() {
    if (!(await this.exists(this.demosRoot))) return [];
    const entries = await readdir(this.demosRoot, { withFileTypes: true });
    const demos = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(this.demosRoot, entry.name, 'demo.yaml');
      if (!(await this.exists(file))) continue;
      try {
        const document = YAML.parse(await readFile(file, 'utf8'));
        demos.push({
          id: document.id,
          title: document.title,
          description: document.description,
          sceneCount: document.scenes?.length || 0
        });
      } catch (error) {
        // A broken YAML is still a demo the operator needs to see and fix.
        demos.push({
          id: entry.name,
          title: entry.name,
          description: (error as Error).message,
          sceneCount: 0,
          invalid: true
        });
      }
    }
    return demos.sort((left, right) => String(left.title).localeCompare(String(right.title)));
  }

  /**
   * What this host can actually do, so the screen can say so instead of letting
   * a stage fail mysteriously. The app server image carries node but neither
   * ffmpeg nor a Playwright browser, so `record` and `render` only work where
   * those were installed.
   */
  private async capabilities() {
    const browsersPath = this.runtimeEnv.PLAYWRIGHT_BROWSERS_PATH || process.env.PLAYWRIGHT_BROWSERS_PATH;
    const chromiumPath =
      this.runtimeEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    const [ffmpeg, managedBrowsers, systemChromium] = await Promise.all([
      this.canSpawn(this.runtimeEnv.FFMPEG_PATH || process.env.FFMPEG_PATH || 'ffmpeg', ['-version']),
      // Either Playwright's own download (default cache or PLAYWRIGHT_BROWSERS_PATH)
      // or a system Chromium the image installed instead — a slim base image
      // cannot always run the managed download.
      this.exists(browsersPath || path.join(process.env.HOME || '/root', '.cache', 'ms-playwright')),
      chromiumPath ? this.canSpawn(chromiumPath, ['--version']) : Promise.resolve(false)
    ]);
    const browsers = managedBrowsers || systemChromium;
    return {
      pipelineRoot: this.projectRoot,
      hasFactory: await this.exists(this.demosRoot),
      canRecord: browsers,
      canRender: ffmpeg
    };
  }

  private canSpawn(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: 'ignore', shell: false });
      child.once('error', () => resolve(false));
      child.once('exit', (code) => resolve(code === 0));
    });
  }

  private async loadDemoDocument(demoId: string) {
    assertSafeId(demoId, 'demo id');
    const file = safeChildPath(this.demosRoot, demoId, 'demo.yaml');
    const raw = await readFile(file, 'utf8');
    return { demo: YAML.parse(raw), raw, file };
  }

  /** Run a pipeline stage to completion and return its exit code and output. */
  private runCli(script: string, args: string[]): Promise<{ code: number; output: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [script, ...args], {
        cwd: this.projectRoot,
        env: { ...process.env, ...this.definedEnv() },
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

  private definedEnv(): Record<string, string> {
    return Object.fromEntries(Object.entries(this.runtimeEnv).filter(([, value]) => value !== ''));
  }

  @B1Action({ description: 'Demos, runtime settings, host capabilities and the current job in one call' })
  async state() {
    return {
      demos: await this.listDemos(),
      settings: publicSettings(this.runtimeEnv),
      capabilities: await this.capabilities(),
      job: this.job
    };
  }

  @B1Action({ description: 'Read one demo definition' })
  async getDemo({ body: { demoId = '' } = {} }: B1ActionPayload<{ demoId?: string }> = {}) {
    const { demo, raw } = await this.loadDemoDocument(demoId);
    return { demo, raw };
  }

  /**
   * Write a demo, then prove it still validates — restoring the previous file
   * if it does not, so the editor can never leave an unrunnable demo on disk.
   */
  @B1Action({ description: 'Write a demo definition, rolling back if it no longer validates' })
  async saveDemo({ body: { demoId = '', demo } = {} }: B1ActionPayload<{ demoId?: string; demo?: unknown }> = {}) {
    assertSafeId(demoId, 'demo id');
    if (!demo || typeof demo !== 'object') throw new Error('A demo document is required');
    if ((demo as { id?: string }).id !== demoId) throw new Error('Demo id cannot be changed from this editor');

    const file = safeChildPath(this.demosRoot, demoId, 'demo.yaml');
    const previous = await readFile(file, 'utf8');
    await writeFile(file, YAML.stringify(demo, { lineWidth: 0 }), 'utf8');

    const { code, output } = await this.runCli('src/cli.mjs', ['validate', demoId]);
    if (code !== 0) {
      await writeFile(file, previous, 'utf8');
      throw new Error(`Not saved — the demo no longer validates:\n${output.trim()}`);
    }
    return { demo, validated: true };
  }

  @B1Action({ description: 'Create a demo by copying an existing one' })
  async createDemo({
    body: { id = '', title = '', sourceId = '' } = {}
  }: B1ActionPayload<{ id?: string; title?: string; sourceId?: string }> = {}) {
    assertSafeId(id, 'demo id');
    assertSafeId(sourceId, 'source demo id');
    const targetDirectory = safeChildPath(this.demosRoot, id);
    if (await this.exists(targetDirectory)) throw new Error('A demo with this id already exists');

    const { demo: source } = await this.loadDemoDocument(sourceId);
    // A demo document is YAML data, so a JSON round trip is a faithful deep copy
    // and keeps the file inside the eslint config's Node 16 baseline.
    const demo = { ...JSON.parse(JSON.stringify(source)), id, title: String(title).trim() || id };
    demo.description = `Created from ${sourceId} in the Demo Factory Studio.`;

    await mkdir(targetDirectory, { recursive: false });
    await writeFile(path.join(targetDirectory, 'demo.yaml'), YAML.stringify(demo, { lineWidth: 0 }), 'utf8');

    const { code, output } = await this.runCli('src/cli.mjs', ['validate', id]);
    if (code !== 0) throw new Error(`Created, but it does not validate:\n${output.trim()}`);
    return { demo };
  }

  @B1Action({ description: 'Recorded and rendered runs for a demo, newest first' })
  async runs({ body: { demoId = '' } = {} }: B1ActionPayload<{ demoId?: string }> = {}) {
    assertSafeId(demoId, 'demo id');
    const root = safeChildPath(this.outputRoot(), demoId);
    if (!(await this.exists(root))) return { runs: [] };

    const entries = await readdir(root, { withFileTypes: true });
    const runs = [];
    for (const entry of entries
      .filter((value) => value.isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 30)) {
      const runDir = safeChildPath(root, entry.name);
      const manifest = await this.readJson<{
        createdAt?: string;
        narrationProvider?: string;
        scenes?: {
          id: string;
          title: string;
          clipFile?: string;
          recordedDurationMs?: number;
          narrationDurationMs?: number;
        }[];
      }>(path.join(runDir, 'run-manifest.json'));
      const result = await this.readJson<{ totalDurationMs?: number }>(path.join(runDir, 'render-result.json'));
      const hasVideo = await this.exists(path.join(runDir, `${demoId}.mp4`));

      runs.push({
        runId: entry.name,
        createdAt: manifest?.createdAt || entry.name.split('--')[0],
        provider: manifest?.narrationProvider || null,
        sceneCount: manifest?.scenes?.length || 0,
        recordedScenes: manifest?.scenes?.filter((scene) => scene.clipFile).length || 0,
        durationMs: result?.totalDurationMs || null,
        hasVideo,
        scenes: (manifest?.scenes || []).map((scene) => ({
          id: scene.id,
          title: scene.title,
          durationMs: scene.recordedDurationMs || scene.narrationDurationMs || null,
          hasClip: Boolean(scene.clipFile)
        }))
      });
    }
    return { runs };
  }

  @B1Action({ description: 'Start a pipeline stage (validate, prepare, record, render or all)' })
  async startJob({
    body: { action = 'validate', demoId = '', scenes = [], voice } = {}
  }: B1ActionPayload<{ action?: JobAction; demoId?: string; scenes?: string[]; voice?: string }> = {}) {
    if (this.job.status === 'running') throw new Error('Another job is already running');
    const command = buildJobCommand({ action, demoId, scenes, voice });

    this.job = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      action,
      demoId,
      status: 'running',
      step: command.step,
      logs: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null
    };

    // Deliberately not awaited: the action returns immediately and the screen
    // polls `job`, which is what keeps a 90-second render from timing out the
    // HTTP request that started it.
    void this.execute(command.script, command.args);
    return { job: this.job };
  }

  private async execute(script: string, args: string[]): Promise<void> {
    try {
      const child = spawn(process.execPath, [script, ...args], {
        cwd: this.projectRoot,
        env: { ...process.env, ...this.definedEnv() },
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
    }
  }

  @B1Action({ description: 'Current pipeline job, including its log tail' })
  async jobStatus() {
    return this.job;
  }

  @B1Action({ description: 'Stop the running pipeline job' })
  async cancelJob() {
    if (this.job.status !== 'running') return this.job;
    this.job.status = 'cancelled';
    this.appendLog('Cancelled by the operator.', 'stderr');
    this.activeChild?.kill('SIGTERM');
    return this.job;
  }

  @B1Action({ description: 'Runtime settings, with secrets reduced to whether they are configured' })
  async getSettings() {
    return { settings: publicSettings(this.runtimeEnv) };
  }

  @B1Action({ description: 'Update runtime settings held in the server process' })
  async saveSettings({ body: { values = {} } = {} }: B1ActionPayload<{ values?: Record<string, string> }> = {}) {
    for (const [key, value] of Object.entries(values)) {
      if (!(ALLOWED_ENV_KEYS as readonly string[]).includes(key)) continue;
      // A blank secret means "leave the configured one alone", never "clear it":
      // the browser is never told the value, so it cannot send it back.
      if (SECRET_ENV_KEYS.has(key) && !value) continue;
      this.runtimeEnv[key] = String(value ?? '');
    }
    return { settings: publicSettings(this.runtimeEnv) };
  }
}
