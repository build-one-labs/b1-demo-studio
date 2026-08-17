/* eslint-disable security/detect-non-literal-fs-filename --
 * Same reasoning as demo-factory.actions.ts: the probes look for tools and
 * caches at paths built at runtime, none of which come from a caller.
 */
import { spawn } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { Injectable } from '@nestjs/common';

import {
  ALLOWED_ENV_KEYS,
  HostCapabilities,
  JOB_ACTIONS,
  JobAction,
  projectRootFrom,
  readProvisionedEnv,
  resolveApiKey,
  SECRET_ENV_KEYS,
  stageBlockedReasons
} from './demo-factory.lib';
import { HostRow, SettingRow, StageRow } from './demo-factory.rows';

/**
 * What this host can do, and how the pipeline is configured to do it.
 *
 * Runtime settings, the provisioner's defaults, tool probing and the capability
 * verdict used to live inside the Studio actions. They moved here when the
 * Settings tab and the stage buttons became data sources: the handlers behind
 * those data sources and the action that spawns the pipeline must read the
 * *same* state, or a key pasted into Settings enables Record on the screen and
 * is missing from the process that records.
 *
 * Settings live in this process, exactly as upstream keeps them in the Studio
 * server: they carry an ElevenLabs key, and writing that into a data source
 * would put it in the blueprint's version history and in git.
 */
@Injectable()
export class DemoFactoryHost {
  /** The pipeline: `demo-factory/` beside this server's `src/`. */
  readonly projectRoot = projectRootFrom(__dirname);

  private runtimeEnv: Record<string, string> = Object.fromEntries(
    ALLOWED_ENV_KEYS.map((key) => [key, process.env[key] || ''])
  );

  /** What the provisioner left for this server, beneath anything typed into Settings. */
  private provisionedEnv: Record<string, string> = {};

  /**
   * Tool paths this server found by probing, beneath both of the above.
   *
   * Detection and use have to agree: a host where the capability check says
   * "browser ok" because it found `/usr/bin/chromium` must also spawn the
   * pipeline with that path, or Record is enabled and then dies looking for a
   * managed download that was never there.
   */
  private discoveredEnv: Record<string, string> = {};

  /** What each probe found, so a polling screen does not re-spawn every tool per second. */
  private probed: Record<string, string | null> = {};

  async loadProvisionedEnv(): Promise<void> {
    this.provisionedEnv = await readProvisionedEnv(this.projectRoot);
  }

  /** The effective value of a setting: operator's, else provisioned, else unset. */
  setting(key: string): string {
    return this.runtimeEnv[key] || this.provisionedEnv[key] || '';
  }

  effectiveSettings(): Record<string, string> {
    return Object.fromEntries(ALLOWED_ENV_KEYS.map((key) => [key, this.setting(key)]));
  }

  /** Where the setting's effective value came from — shown next to it in the Studio. */
  private settingSource(key: string): SettingRow['source'] {
    if (this.runtimeEnv[key] && this.runtimeEnv[key] !== (process.env[key] || '')) return 'operator';
    if (this.runtimeEnv[key]) return 'environment';
    if (this.provisionedEnv[key]) return 'provisioned';
    return 'unset';
  }

  /**
   * Accept a setting from the Studio. A blank secret means "leave the configured
   * one alone", never "clear it": the browser is never told the value, so it
   * cannot send it back.
   */
  applySetting(key: string, value: string): void {
    if (!(ALLOWED_ENV_KEYS as readonly string[]).includes(key)) return;
    if (SECRET_ENV_KEYS.has(key) && !value) return;
    this.runtimeEnv[key] = String(value ?? '');
  }

  outputRoot(): string {
    const configured = this.setting('DEMO_OUTPUT_DIR') || process.env.DEMO_OUTPUT_DIR;
    return configured ? path.resolve(this.projectRoot, configured) : path.join(this.projectRoot, 'output');
  }

  /** Discovered paths first, so anything configured still wins over a probe. */
  definedEnv(): Record<string, string> {
    return {
      ...this.discoveredEnv,
      ...Object.fromEntries(Object.entries(this.effectiveSettings()).filter(([, value]) => value !== ''))
    };
  }

  /**
   * What this host can actually do, so the screen can say so instead of letting
   * a stage fail mysteriously. The app server image installs ffmpeg and a
   * system Chromium and names them in its environment; anywhere else `record`
   * and `render` depend on what this finds.
   */
  async capabilities(): Promise<HostCapabilities & { pipelineRoot: string }> {
    // The one gate every caller passes through, so the one place to pick up
    // what the workspace provisioner may have written since the last call.
    await this.loadProvisionedEnv();
    const browsersPath = this.setting('PLAYWRIGHT_BROWSERS_PATH') || process.env.PLAYWRIGHT_BROWSERS_PATH;
    const [ffmpeg, ffprobe, managedBrowsers, systemChromium, hasFactory, hasDependencies] = await Promise.all([
      this.resolveTool('FFMPEG_PATH', FFMPEG_PATHS, ['-version']),
      this.resolveTool('FFPROBE_PATH', FFPROBE_PATHS, ['-version']),
      // Either Playwright's own download (default cache or PLAYWRIGHT_BROWSERS_PATH)
      // or a system Chromium the image installed instead — a slim base image
      // cannot always run the managed download.
      this.hasManagedBrowser(browsersPath || path.join(process.env.HOME || '/root', '.cache', 'ms-playwright')),
      this.resolveTool('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', CHROMIUM_PATHS, ['--version']),
      this.exists(path.join(this.projectRoot, 'demos')),
      this.hasDependencies()
    ]);

    const apiKey = this.workspaceApiKey();

    // Only absolute paths are worth passing on — see CHROMIUM_PATHS. A tool
    // found unqualified on PATH still counts as present, because the child
    // process inherits the same PATH and falls back to it the same way.
    this.discoveredEnv = {
      ...(systemChromium?.startsWith('/')
        ? { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: systemChromium, REMOTION_BROWSER_EXECUTABLE: systemChromium }
        : {}),
      ...(ffmpeg?.startsWith('/') ? { FFMPEG_PATH: ffmpeg } : {}),
      ...(ffprobe?.startsWith('/') ? { FFPROBE_PATH: ffprobe } : {}),
      // Under the unqualified name: the pipeline is given the key that was
      // found, not the variable it happened to be scoped under.
      ...(apiKey ? { B1_USER_API_KEY: apiKey } : {})
    };

    return {
      pipelineRoot: this.projectRoot,
      hasFactory,
      hasDependencies,
      canRecord: managedBrowsers || Boolean(systemChromium),
      // Both, not just ffmpeg: render measures every clip with ffprobe before it
      // composes anything, so an image with one and not the other fails late.
      canRender: Boolean(ffmpeg) && Boolean(ffprobe),
      canAuthenticate: Boolean(this.setting('B1_USER_API_KEY') || apiKey)
    };
  }

  // ---- Row projections for the data sources -------------------------------

  /** The Settings tab, one row per allowed key. Secrets carry no value. */
  async settingRows(): Promise<SettingRow[]> {
    await this.loadProvisionedEnv();
    return ALLOWED_ENV_KEYS.map((key, index) => {
      const secret = SECRET_ENV_KEYS.has(key);
      const value = this.setting(key);
      return {
        key,
        label: key,
        value: secret ? '' : value,
        configured: Boolean(value),
        secret,
        source: this.settingSource(key),
        sequence: index + 1
      };
    });
  }

  /** The stage buttons, with the server's own verdict on each. */
  async stageRows(): Promise<StageRow[]> {
    const blocked = stageBlockedReasons(await this.capabilities());
    return JOB_ACTIONS.map((id, index) => ({
      id,
      label: STAGE_LABELS[id].label,
      hint: STAGE_LABELS[id].hint,
      sequence: index + 1,
      allowed: blocked[id] === null,
      blockedReason: blocked[id] ?? ''
    }));
  }

  async hostRow(): Promise<HostRow> {
    const { pipelineRoot, hasFactory, hasDependencies, canRecord, canRender, canAuthenticate } =
      await this.capabilities();
    return { id: 'host', pipelineRoot, hasFactory, hasDependencies, canRecord, canRender, canAuthenticate };
  }

  // ---- Probes -------------------------------------------------------------

  /**
   * The configured tool if it runs, else the first candidate that does.
   *
   * A configured value is never silently replaced: an operator who typed a path
   * into Settings and got it wrong should see the stage blocked, not watch this
   * quietly record with some other browser they did not choose.
   */
  private async resolveTool(key: string, candidates: string[], args: string[]): Promise<string | null> {
    const configured = this.setting(key);
    if (configured) return (await this.canSpawn(configured, args)) ? configured : null;
    if (key in this.probed) return this.probed[key];
    for (const candidate of candidates) {
      if (await this.canSpawn(candidate, args)) return (this.probed[key] = candidate);
    }
    return (this.probed[key] = null);
  }

  /**
   * A Playwright browser cache with a browser in it.
   *
   * The directory alone is not the signal it looks like: a workspace points
   * `PLAYWRIGHT_BROWSERS_PATH` at a cache holding nothing but Playwright's
   * bundled ffmpeg, which `recordVideo` needs and which is not a browser.
   */
  private async hasManagedBrowser(root: string): Promise<boolean> {
    const entries = await readdir(root).catch(() => [] as string[]);
    return entries.some((name) => name.startsWith('chromium'));
  }

  /**
   * The pipeline's dependencies are this server's (one package.json, installed
   * by the root `yarn install`), so on a normal host this is true. It stays a
   * check because `src/cli.mjs` imports Playwright and Remotion at load, before
   * it reads its arguments: an image built without them makes every stage die
   * identically with a module resolution stack trace from a child process.
   * Cheaper to say so up front. Resolved the way the spawned process will
   * resolve them — from the pipeline's directory, up the tree — not by
   * looking for a `node_modules` folder that yarn is free to hoist away.
   */
  private async hasDependencies(): Promise<boolean> {
    const resolve = createRequire(path.join(this.projectRoot, 'package.json'));
    const required = ['@playwright/test', '@remotion/bundler', '@remotion/renderer', 'yaml', 'zod'];
    return required.every((name) => {
      try {
        resolve.resolve(name);
        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * `all` signs the recording browser in with the user API key for this
   * deployment's auth server, which is named for it
   * (`B1_USER_API_KEY__TRY_AUTH_TEST_BUILD_ONE`).
   *
   * Returned rather than merely counted, because the pipeline reads the
   * unqualified `B1_USER_API_KEY` and nothing scoped: the same rule as the
   * browser and ffmpeg paths — what the capability check found is what the
   * spawned process is given, so "can authenticate" and "did authenticate"
   * cannot disagree.
   */
  private workspaceApiKey(): string {
    return resolveApiKey(process.env, process.env.AUTH_URL)?.key || '';
  }

  private canSpawn(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: 'ignore', shell: false });
      child.once('error', () => resolve(false));
      child.once('exit', (code) => resolve(code === 0));
    });
  }

  private async exists(file: string): Promise<boolean> {
    return access(file).then(
      () => true,
      () => false
    );
  }
}

/**
 * Where a system browser and ffmpeg live when nothing was configured.
 *
 * The app server image installs both and names them in its own environment, so
 * these are the fallback for every other host: a workspace whose provisioner
 * has not run yet, or an image built from a different distribution, where the
 * tools are present under a name this server was never told.
 *
 * Absolute paths only. A discovered browser is handed to Playwright as
 * `executablePath` and to Remotion as its browser executable, and neither
 * searches PATH — so a bare command name would satisfy the capability check and
 * then fail at launch, which is exactly the confusion this is here to remove.
 */
const CHROMIUM_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/lib/chromium/chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome'
];

/** `ffmpeg` last: unqualified on PATH is what the pipeline itself falls back to. */
const FFMPEG_PATHS = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'];

const FFPROBE_PATHS = ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe', 'ffprobe'];

/**
 * How the Studio names each stage. Kept beside the verdict rather than in the
 * screen, so a stage row is complete on its own and a screen that lists them
 * needs no table of its own to decode the ids.
 */
export const STAGE_LABELS: Record<JobAction, { label: string; hint: string }> = {
  validate: { label: 'Validate', hint: 'Schema and cues' },
  prepare: { label: 'Prepare', hint: 'Voice and timing' },
  record: { label: 'Record', hint: 'Drives a browser' },
  render: { label: 'Render', hint: 'MP4 and SRT' },
  all: { label: 'Run full demo', hint: 'Validate, sign in, prepare, record and render' }
};
