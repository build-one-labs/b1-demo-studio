/**
 * Turns the clip scenes of a video demo into filmed scenes: route + Playwright
 * actions that perform in the live application what the author's recording
 * shows, with `[cue:…]` markers in the narration that time the actions.
 *
 * Per scene:
 *
 * 1. Keyframes of the clip (its start, every screen change inside it, its
 *    end) and the author's words with their times — what happened, and when.
 * 2. The live application at the scene's start (sceneBaseUrl + route): a
 *    screenshot and Playwright's ARIA snapshot, so the selectors Claude writes
 *    name elements that exist, by the names Playwright resolves.
 * 3. Claude (vision) proposes the actions, as JSON the demo schema validates.
 * 4. A trial: a fresh signed-in browser opens the route and runs the actions
 *    and assertions at full speed. A failure goes back to Claude with the
 *    error, a screenshot and a snapshot of the page where it failed — at most
 *    MAX_REPAIRS times.
 *
 * A scene whose trial passes becomes `mode: film` (its clip stays as the
 * fallback); one that still fails stays a clip, with the last proposal kept as
 * an inert draft and the reason in `conversion.message`. Nothing here writes
 * the demo: the result goes to `<upload>/converted.json`, which the server
 * saves through its one validated write path.
 */
import { execFile } from 'node:child_process';
import { newTakeContext } from './credentials.mjs';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from '@playwright/test';
import { z } from 'zod';
import { demoSchema, isClipScene, sceneBaseUrl } from '../schema.mjs';
import { executeAssertions, executeSceneActions, resolveDemoUrl } from './actions.mjs';
import { envBoolean, resolveApiKey } from './env.mjs';
import { readJson, validateDemoSemantics, writeJson } from './files.mjs';
import { step, warn } from './log.mjs';
import { resetRepository } from './reset.mjs';
import { resolveSourceVideo, uploadDir } from './source-video.mjs';

const run = promisify(execFile);
const ffmpeg = () => process.env.FFMPEG_PATH || 'ffmpeg';

/** Claude Opus 5.5 by default; DEMO_CONVERT_MODEL picks another. */
export const DEFAULT_CONVERT_MODEL = 'claude-opus-5-5';
export const MAX_KEYFRAMES = 8;
export const MAX_REPAIRS = 2;
const SNAPSHOT_CHARS = 14_000;
const FRAME_WIDTH = 1280;

// ---- Keyframes and transcript ----------------------------------------------------

/**
 * Where to look inside a clip (ms from the start of the source video): just
 * after it starts, just after every screen change inside it, and just before
 * it ends. Close neighbours collapse; a long clip is thinned evenly.
 */
export const keyframeTimes = (clip, cuts = [], { max = MAX_KEYFRAMES, minGapMs = 1200 } = {}) => {
  const { startMs, endMs } = clip;
  const candidates = [
    startMs + Math.min(600, (endMs - startMs) / 4),
    ...cuts.filter((cut) => cut.atMs > startMs + 300 && cut.atMs < endMs - 300).map((cut) => cut.atMs + 400),
    endMs - Math.min(400, (endMs - startMs) / 4)
  ]
    .map(Math.round)
    .filter((time) => time >= startMs && time < endMs)
    .sort((a, b) => a - b);
  const kept = [];
  for (const time of candidates) if (!kept.length || time - kept.at(-1) >= minGapMs) kept.push(time);
  if (kept.length <= max) return kept;
  // Keep the first and the last, and evenly spaced ones in between.
  return Array.from({ length: max }, (_, index) => kept[Math.round((index * (kept.length - 1)) / (max - 1))]);
};

/** The author's words inside a clip, one line per pause, timed from the clip's start. */
export const timedTranscript = (words, clip) => {
  const inside = words.filter((word) => word.startMs >= clip.startMs && word.startMs < clip.endMs);
  const lines = [];
  let current = null;
  for (const word of inside) {
    const at = word.startMs - clip.startMs;
    if (!current || word.startMs - current.lastEndMs > 700 || /[.!?]$/.test(current.words.at(-1))) {
      current = { atMs: at, words: [], lastEndMs: word.endMs };
      lines.push(current);
    }
    current.words.push(word.text);
    current.lastEndMs = word.endMs;
  }
  return lines.map((line) => `[${(line.atMs / 1000).toFixed(1)}s] ${line.words.join(' ')}`).join('\n');
};

const extractFrame = async (source, atMs, target) => {
  await run(ffmpeg(), [
    '-v',
    'error',
    '-y',
    '-ss',
    (atMs / 1000).toFixed(3),
    '-i',
    source,
    '-frames:v',
    '1',
    '-vf',
    `scale=${FRAME_WIDTH}:-2`,
    '-q:v',
    '4',
    target
  ]);
  return target;
};

// ---- What Claude answers ---------------------------------------------------------

/**
 * The answer, as structured output. Every field is required and nullable —
 * the strict-schema way of saying "optional" — and becomes a demo action once
 * the nulls are dropped (toDemoActions), which demoSchema then validates.
 */
const targetJson = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['role', 'name', 'label', 'text', 'css'],
  properties: {
    role: {
      type: ['string', 'null'],
      description: 'ARIA role, as in the snapshot (button, link, textbox, menuitem, tab, row, cell, …)'
    },
    name: { type: ['string', 'null'], description: 'Accessible name with role, as in the snapshot' },
    label: { type: ['string', 'null'], description: 'A form field by its label' },
    text: { type: ['string', 'null'], description: 'Exact visible text' },
    css: { type: ['string', 'null'], description: 'CSS selector — last resort' }
  }
};

export const CONVERSION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['narration', 'actions', 'assertions', 'confidence', 'notes'],
  properties: {
    narration: {
      type: 'string',
      description: 'The scene narration, unchanged in wording, with [cue:name] markers inserted where actions happen'
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'cue', 'target', 'route', 'value', 'key', 'durationMs', 'timeoutMs'],
        properties: {
          action: {
            type: 'string',
            enum: ['goto', 'click', 'dblclick', 'fill', 'type', 'press', 'hover', 'highlight', 'waitFor']
          },
          cue: {
            type: ['string', 'null'],
            description:
              'Name of the [cue:name] in the narration this action happens at; null = right after the previous action'
          },
          target: targetJson,
          route: { type: ['string', 'null'], description: 'goto only: a path, or an absolute URL' },
          value: { type: ['string', 'null'], description: 'fill / type: the text' },
          key: { type: ['string', 'null'], description: 'press: the key, e.g. Enter' },
          durationMs: { type: ['integer', 'null'], description: 'highlight: how long' },
          timeoutMs: { type: ['integer', 'null'], description: 'waitFor and slow actions: the timeout' }
        }
      }
    },
    assertions: {
      type: 'array',
      description: 'Elements visible at the end of the scene — what proves it worked',
      items: { ...targetJson, type: 'object' }
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: { type: 'string', description: 'One or two sentences for the author: assumptions, what to check' }
  }
};

const compact = (object) =>
  Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== '')
  );

/** Claude's answer → scene fields the demo schema accepts. */
export const toDemoScene = (answer) => ({
  narration: answer.narration,
  actions: answer.actions.map(({ cue, target, ...rest }) =>
    compact({
      ...rest,
      ...(cue ? { atCue: cue } : {}),
      ...(target && Object.values(target).some(Boolean) ? { target: compact(target) } : {})
    })
  ),
  assertions: answer.assertions
    .filter((target) => Object.values(target).some(Boolean))
    .map((target) => ({ visible: compact(target) }))
});

const SYSTEM_PROMPT = `You turn one scene of a screen recording of a web application into a script that Playwright performs in the live application, so the scene can be re-filmed cleanly.

You get, for one scene:
- keyframes of the author's recording, each with its time from the scene's start,
- what the author said, with times,
- the live application at the scene's start URL: a screenshot and Playwright's ARIA snapshot.

Write the actions that reproduce what the recording shows, starting from that start page in a fresh browser. Rules:
- Targets: prefer role + name exactly as the ARIA snapshot shows them; then label; then exact text; css only as a last resort. A target must match one element — add the name, or pick a more specific role.
- Use only elements you can see in the snapshot or keyframes. If the recording shows steps the live app cannot repeat (other data, other user), do the closest equivalent and say so in notes.
- Steps needed to reach the state the recording starts in come first, with cue null: they run immediately.
- After an action that loads a screen or opens a dialog, add a waitFor on an element of the new state (timeoutMs 15000 when it loads data).
- Typing visible to the viewer: "type"; form filling not worth watching: "fill".
- Narration: keep the author's wording exactly. Insert [cue:name] markers (lowercase-with-dashes names, each once) right before the words the action belongs to, and give the action that cue. Actions without a cue run right after the previous one.
- Assertions: one to three elements that are visible when the scene is done.
- Never sign in or out, never enter credentials, never delete data.
- Never target the signed-in user by name, e-mail or avatar text: the take may run as another account (a demo user). Reach the user menu and other per-user elements by a stable selector from the snapshot (a data-testid, a role) instead.
- The trial run acts in the live application as a real user, and every scene is tried and filmed again and again. So submit, send or save only what this scene's own narration shows being submitted — at most once per scene. Steps replayed to reach the scene's starting state navigate, open and select only: they never send a message, submit a form or save a record again. If the scene needs the result of an earlier submission that a replay cannot reach without repeating it, start from the closest state you can reach by navigation and say so in notes.`;

const imageBlock = async (file, mediaType = 'image/jpeg') => ({
  type: 'image',
  source: { type: 'base64', media_type: mediaType, data: (await readFile(file)).toString('base64') }
});

// ---- The live application --------------------------------------------------------

export const openContext = async ({ browser, demo, authState, apiKey }) =>
  newTakeContext(browser, {
    demo,
    authState,
    apiKey,
    viewport: demo.settings.viewport,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: demo.settings.language === 'de' ? 'de-DE' : demo.settings.language
  });

export const waitForApp = (page) =>
  page
    .locator('[data-demo-id="app-ready"], .b1-shell-row')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {});

/** What a page looks like to Playwright: a screenshot and its ARIA snapshot, trimmed. */
export const capturePage = async (page, file) => {
  await page.screenshot({ path: file, type: 'jpeg', quality: 70 });
  const snapshot = await page
    .locator('body')
    .ariaSnapshot({ timeout: 10_000 })
    .catch((error) => `(no snapshot: ${error.message})`);
  return {
    file,
    snapshot: snapshot.length > SNAPSHOT_CHARS ? `${snapshot.slice(0, SNAPSHOT_CHARS)}\n… (truncated)` : snapshot,
    url: page.url()
  };
};

/** Run a proposal in a fresh browser, as fast as it goes. Resolves to null, or to what went wrong. */
const trialRun = async ({ browser, demo, scene, startUrl, appUrl, authState, apiKey, shotFile }) => {
  const context = await openContext({ browser, demo, authState, apiKey });
  const page = await context.newPage();
  try {
    await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForApp(page);
    // No cues, no cursor: every action runs as soon as the previous finished.
    await executeSceneActions({
      page,
      scene: { ...scene, cues: {} },
      baseUrl: appUrl,
      narrationStartTime: Date.now(),
      cursor: { enabled: false }
    });
    await executeAssertions({ page, assertions: scene.assertions });
    return null;
  } catch (error) {
    const capture = await capturePage(page, shotFile).catch(() => null);
    return { message: error.message.split('\n')[0].slice(0, 400), detail: error.message.slice(0, 2000), capture };
  } finally {
    await context.close();
  }
};

// ---- Claude ----------------------------------------------------------------------

const askClaude = async ({ client, model, messages }) => {
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16_000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: CONVERSION_JSON_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages
  });
  if (response.stop_reason === 'refusal')
    throw new Error(`Claude declined the scene (${response.stop_details?.category ?? 'no category'})`);
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens');
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return { answer: JSON.parse(text), content: response.content, model: response.model };
};

/** Validate a proposal the way the pipeline will: as a filmed scene of this demo. */
const validateProposal = (demo, scene, proposal) => {
  const candidate = { ...scene, ...proposal, mode: 'film' };
  const parsed = demoSchema.parse({ ...demo, scenes: [candidate] });
  validateDemoSemantics(parsed);
  return parsed.scenes[0];
};

// ---- The conversion --------------------------------------------------------------

export const convertDemo = async ({ demo, sceneFilter = null }) => {
  if (!demo.source)
    throw new Error(`${demo.id} has no source video — only a demo imported from a screen recording can be converted`);
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error('No Anthropic API key — store the anthropic-api-key secret or set ANTHROPIC_API_KEY');
  const uploadId = demo.source.video.split('/')[0];
  const directory = uploadDir(uploadId);
  const source = resolveSourceVideo(demo.source);
  const cuts = await readJson(path.join(directory, 'cuts.json')).catch(() => []);
  const words = (await readJson(path.join(directory, 'transcript.json')).catch(() => ({ words: [] }))).words ?? [];
  const framesDir = path.join(directory, 'convert');
  await mkdir(framesDir, { recursive: true });

  const candidates = demo.scenes.filter(
    (scene) => scene.clip && isClipScene(scene) && (!sceneFilter || sceneFilter.has(scene.id))
  );
  if (!candidates.length) throw new Error('No clip scene to convert');
  const model = process.env.DEMO_CONVERT_MODEL || DEFAULT_CONVERT_MODEL;
  const client = new Anthropic();
  const authState = process.env[demo.settings.authStateEnv]
    ? await readFile(process.env[demo.settings.authStateEnv]).then(
        () => process.env[demo.settings.authStateEnv],
        () => undefined
      )
    : undefined;
  const apiKey = resolveApiKey()?.key;
  const browser = await chromium.launch({
    headless: envBoolean(demo.settings.headlessEnv, true),
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
  });
  step(
    `Converting ${candidates.length} scene(s) of ${demo.id} with ${model} (${authState ? 'signed-in storage state' : apiKey ? 'x-api-key header' : 'no credentials'})`
  );

  // The trial runs change the application like a take does; with the
  // setting on, they start from the delivered state too.
  if (demo.settings.resetRepository) {
    const appUrl = sceneBaseUrl(demo, {});
    step(`Resetting the blueprint repository of ${new URL(appUrl).origin} before the trial runs`);
    await resetRepository({ browser, appUrl, authState, apiKey }).catch(async (error) => {
      await browser.close();
      throw error;
    });
  }

  const converted = new Map();
  // The film-mode version of every scene so far, in demo order: a recording
  // runs on from one scene into the next, but a filmed scene starts in a fresh
  // browser, so a scene's script first replays the way to where the previous
  // one ended — Claude needs to know what that was.
  const filmedVersion = (scene) => {
    const current = converted.get(scene.id) ?? scene;
    return isClipScene(current) ? null : current;
  };
  try {
    for (const [index, scene] of candidates.entries()) {
      const label = `Scene ${index + 1}/${candidates.length}: ${scene.id}`;
      const position = demo.scenes.findIndex((candidate) => candidate.id === scene.id);
      const previous = position > 0 ? filmedVersion(demo.scenes[position - 1]) : null;
      try {
        converted.set(scene.id, await convertScene({ scene, label, previous }));
      } catch (error) {
        warn(`${label} — ${error.message}`);
        converted.set(scene.id, {
          ...scene,
          mode: 'clip',
          conversion: { status: 'failed', message: error.message.slice(0, 400), at: new Date().toISOString(), model }
        });
      }
    }
  } finally {
    await browser.close();
  }

  async function convertScene({ scene, label, previous }) {
    const appUrl = sceneBaseUrl(demo, scene);
    const route = scene.route || '/';
    const startUrl = resolveDemoUrl(route, appUrl);

    // 1. The recording.
    const times = keyframeTimes(scene.clip, cuts);
    const frames = [];
    for (const atMs of times)
      frames.push({
        atMs: atMs - scene.clip.startMs,
        file: await extractFrame(source, atMs, path.join(framesDir, `${scene.id}-${atMs}.jpg`))
      });
    const transcript = timedTranscript(words, scene.clip) || '(the author said nothing in this scene)';

    // 2. The live application where the scene starts.
    const context = await openContext({ browser, demo, authState, apiKey });
    const page = await context.newPage();
    let start;
    try {
      await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 30_000 });
      await waitForApp(page);
      start = await capturePage(page, path.join(framesDir, `${scene.id}-live.jpg`));
    } finally {
      await context.close();
    }
    if (/\/sign-in/.test(start.url))
      throw new Error(`${startUrl} shows the sign-in page — the browser is not signed in to ${appUrl}`);
    step(`${label} — ${frames.length} keyframes, live start page ${start.url}`);

    // 3. + 4. Propose, try, repair.
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Scene "${scene.title}" (${((scene.clip.endMs - scene.clip.startMs) / 1000).toFixed(1)} s of the recording). Keyframes of the author's recording follow, each labelled with its time from the scene's start.`
          },
          ...(
            await Promise.all(
              frames.map(async (frame) => [
                { type: 'text', text: `Recording at ${(frame.atMs / 1000).toFixed(1)}s:` },
                await imageBlock(frame.file)
              ])
            )
          ).flat(),
          {
            type: 'text',
            text: `What the author said:\n${transcript}\n\nThe scene's narration (keep its wording, add the cues):\n${scene.narration || '(empty — leave it empty and give every action cue null)'}`
          },
          {
            type: 'text',
            text: previous
              ? `The previous scene ("${previous.title}") starts at ${previous.route ?? '/'} and performs these actions; this scene's recording continues from where they end, so replay what it takes to get back there first (cue null) — navigation only: leave out the sending, submitting and saving those actions did:\n${JSON.stringify(previous.actions.map(({ atCue, ...action }) => action))}`
              : 'This is the first scene, or the one before it is not filmed: start from the live start page.'
          },
          { type: 'text', text: `The live application at the scene's start URL ${start.url}:` },
          await imageBlock(start.file),
          { type: 'text', text: `Its ARIA snapshot:\n${start.snapshot}` }
        ]
      }
    ];

    let lastProposal = null;
    let lastError = '';
    let usedModel = model;
    for (let attempt = 0; attempt <= MAX_REPAIRS; attempt += 1) {
      let reply;
      try {
        reply = await askClaude({ client, model, messages });
      } catch (error) {
        lastError = `Claude: ${error.message}`;
        warn(`${label} — ${lastError}`);
        break;
      }
      usedModel = reply.model;
      messages.push({ role: 'assistant', content: reply.content });
      let proposal;
      try {
        proposal = validateProposal(demo, { ...scene, route }, toDemoScene(reply.answer));
      } catch (error) {
        lastError = `invalid proposal: ${error.message.slice(0, 300)}`;
        messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `That script does not validate: ${error.message.slice(0, 1500)}. Answer with a corrected script.`
            }
          ]
        });
        continue;
      }
      lastProposal = { ...proposal, notes: reply.answer.notes, confidence: reply.answer.confidence };
      const failure = await trialRun({
        browser,
        demo,
        scene: proposal,
        startUrl,
        appUrl,
        authState,
        apiKey,
        shotFile: path.join(framesDir, `${scene.id}-failure-${attempt}.jpg`)
      });
      if (!failure) {
        lastError = '';
        step(
          `${label} — trial passed (${proposal.actions.length} actions, confidence ${reply.answer.confidence}${attempt ? `, after ${attempt} repair(s)` : ''})`
        );
        break;
      }
      lastError = failure.message;
      warn(`${label} — trial ${attempt + 1} failed: ${failure.message}`);
      if (attempt === MAX_REPAIRS) break;
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `The trial run failed: ${failure.detail}\nThe page where it failed (${failure.capture?.url ?? 'unknown URL'}):`
          },
          ...(failure.capture
            ? [
                await imageBlock(failure.capture.file),
                { type: 'text', text: `Its ARIA snapshot:\n${failure.capture.snapshot}` }
              ]
            : []),
          { type: 'text', text: 'Answer with a corrected script for the whole scene.' }
        ]
      });
    }

    const at = new Date().toISOString();
    if (lastProposal && !lastError) {
      return {
        ...scene,
        route,
        narration: lastProposal.narration,
        actions: lastProposal.actions,
        assertions: lastProposal.assertions,
        mode: 'film',
        conversion: {
          status: 'filmed',
          message: `${lastProposal.confidence} confidence — ${lastProposal.notes}`.trim(),
          at,
          model: usedModel
        }
      };
    }
    // Stays a clip. The draft keeps the original narration, so the
    // voice-over does not change; the proposal is there to fix by hand.
    return {
      ...scene,
      ...(lastProposal
        ? { actions: lastProposal.actions.map(({ atCue, ...action }) => action), assertions: lastProposal.assertions }
        : {}),
      mode: 'clip',
      conversion: { status: 'failed', message: lastError || 'no proposal', at, model: usedModel }
    };
  }

  const scenes = demo.scenes.map((scene) => converted.get(scene.id) ?? scene);
  // An imported demo has the synthetic cursor off — a recording shows the
  // author's own pointer. Filmed scenes have none, so they get the cursor back.
  const anyFilmed = scenes.some((scene) => !isClipScene(scene));
  const document = {
    ...demo,
    settings: anyFilmed ? { ...demo.settings, cursor: { ...demo.settings.cursor, enabled: true } } : demo.settings,
    scenes
  };
  const parsed = demoSchema.parse(document);
  validateDemoSemantics(parsed);
  const target = path.join(directory, 'converted.json');
  await writeJson(target, document);
  const filmed = [...converted.values()].filter((scene) => scene.mode === 'film').length;
  step(
    `Converted ${filmed} of ${converted.size} scene(s) to filmed scenes; ${converted.size - filmed} stay clips of the recording.`
  );
  return { file: target, filmed, total: converted.size };
};
