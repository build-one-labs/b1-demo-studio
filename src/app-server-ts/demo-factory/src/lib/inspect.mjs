/**
 * The live look: what a page of the target application looks like to the
 * recorder, and whether a draft of scene actions runs there — before anyone
 * films it.
 *
 * The Demo Creator agent writes scenes from blueprints; this is how it sees
 * the real page instead of guessing selectors. One request opens a fresh
 * browser signed in as the take would be (the demo's demo user, or the host's
 * key), goes to a page, optionally plays draft actions and assertions there
 * as fast as they go, and reports the page it ended on: a screenshot, its ARIA
 * snapshot — the roles and names Playwright's role selectors match — and, if
 * a step failed, which one and why.
 *
 * The same helpers as the video conversion's trial run (convert.mjs), so a
 * scene that passes here passes there. Like a trial run it acts in the live
 * application as that user: actions that submit or save really do.
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { z } from 'zod';
import { actionSchema, assertionSchema, sceneBaseUrl } from '../schema.mjs';
import { executeAssertions, executeSceneActions, resolveDemoUrl } from './actions.mjs';
import { capturePage, openContext, waitForApp } from './convert.mjs';
import { demoOrigins } from './credentials.mjs';
import { envBoolean, resolveApiKey } from './env.mjs';
import { writeJson } from './files.mjs';
import { step } from './log.mjs';

export const inspectRequestSchema = z
  .object({
    /** An absolute URL to open; else `route` against `baseUrl` (else the demo's base URL). */
    url: z.string().url().optional(),
    route: z.string().optional(),
    baseUrl: z.string().url().optional(),
    /** Draft actions to play after the page opened — the scene's own `actions`. */
    actions: z.array(actionSchema).max(60).default([]),
    /** Checks to run after the actions — the scene's own `assertions`. */
    assertions: z.array(assertionSchema).max(30).default([])
  })
  .strict();

/**
 * Where the request opens: an absolute URL wins, else a route against the
 * scene's or the demo's application. Only an application the demo names —
 * its own base URL or a scene's — may be opened: the browser is signed in as
 * the demo user there, and nowhere else should see that session or its key.
 */
export const inspectStartUrl = (demo, request, env = process.env) => {
  const appUrl = request.baseUrl || sceneBaseUrl(demo, {}, env);
  const startUrl = request.url || resolveDemoUrl(request.route || '/', appUrl);
  const allowed = demoOrigins(demo, env);
  for (const href of new Set([startUrl, appUrl])) {
    const { origin } = new URL(href);
    if (!allowed.has(origin)) {
      throw new Error(
        `Invalid inspect request — ${origin} is not an application of this demo (${[...allowed].join(', ')}). ` +
          "Set it as the demo's or a scene's baseUrl first."
      );
    }
  }
  return startUrl;
};

/**
 * Run one inspection and write its result to `outDir/result.json` (the
 * screenshot beside it as `page.jpg`). Never throws for a failing step: a
 * failure is a finding, reported with the page as it was at that moment.
 */
export const inspectPage = async ({ demo, request: raw, outDir }) => {
  const parsed = inspectRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(request)'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid inspect request — ${issues}`);
  }
  const request = parsed.data;
  await mkdir(outDir, { recursive: true });
  const startUrl = inspectStartUrl(demo, request);
  const appUrl = request.baseUrl || new URL(startUrl).origin + '/';
  const authFile = process.env[demo.settings.authStateEnv];
  const authState = authFile ? await readFile(authFile).then(() => authFile, () => undefined) : undefined;
  const apiKey = resolveApiKey()?.key;
  step(`Inspecting ${startUrl} for ${demo.id} (${authState ? 'signed-in storage state' : apiKey ? 'x-api-key header' : 'no credentials'}; ${request.actions.length} action(s), ${request.assertions.length} assertion(s))`);

  const browser = await chromium.launch({
    headless: envBoolean(demo.settings.headlessEnv, true),
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
  });
  const result = { ok: true, startUrl, error: null };
  try {
    const context = await openContext({ browser, demo, authState, apiKey });
    const page = await context.newPage();
    try {
      await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 30_000 });
      await waitForApp(page);
      if (request.actions.length) {
        await executeSceneActions({
          page,
          scene: { id: 'inspect', actions: request.actions, cues: {} },
          baseUrl: appUrl,
          narrationStartTime: Date.now(),
          cursor: { enabled: false }
        });
      }
      if (request.assertions.length) await executeAssertions({ page, assertions: request.assertions });
    } catch (error) {
      result.ok = false;
      result.error = error.message.split('\n')[0].slice(0, 400);
      result.detail = error.message.slice(0, 2000);
    }
    await page.waitForTimeout(500);
    const capture = await capturePage(page, path.join(outDir, 'page.jpg'));
    Object.assign(result, { url: capture.url, title: await page.title().catch(() => ''), snapshot: capture.snapshot, screenshot: 'page.jpg' });
    await context.close();
  } finally {
    await browser.close();
  }
  await writeJson(path.join(outDir, 'result.json'), result);
  step(result.ok ? `Inspection passed — ended on ${result.url}` : `Inspection stopped: ${result.error}`);
  return result;
};
