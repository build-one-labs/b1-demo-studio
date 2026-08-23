const locatorFor = (page, target) => {
  if (!target) throw new Error('Action target is missing');
  if (target.demoId) return page.locator(`[data-demo-id=${JSON.stringify(target.demoId)}]`);
  if (target.role) return page.getByRole(target.role, target.name ? {name: target.name} : undefined);
  if (target.label) return page.getByLabel(target.label);
  if (target.text) return page.getByText(target.text, {exact: true});
  if (target.css) return page.locator(target.css);
  throw new Error(`Unsupported target: ${JSON.stringify(target)}`);
};

const CURSOR_ID = '__b1-demo-synthetic-cursor';
const POINTER_ACTIONS = new Set(['click', 'dblclick', 'fill', 'type', 'press', 'hover', 'highlight']);
const CLICK_ACTIONS = new Set(['click', 'dblclick', 'fill', 'type']);

export const resolveDemoUrl = (route, baseUrl) => {
  const base = new URL(baseUrl);
  const target = new URL(route, base);
  for (const [name, value] of base.searchParams) {
    if (!target.searchParams.has(name)) target.searchParams.append(name, value);
  }
  return target.href;
};

const waitUntil = async (startTime, targetMs) => {
  const remaining = startTime + targetMs - Date.now();
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
};

const actionTimeMs = (action, cues, fallback) => {
  if (action.atCue) return (cues[action.atCue] ?? 0) + (action.offsetMs || 0);
  if (action.atMs != null) return action.atMs + (action.offsetMs || 0);
  return fallback;
};

export const installDemoCursor = async (page, cursor) => {
  if (!cursor?.enabled) return;
  await page.evaluate(({cursorId, sizePx}) => {
    document.getElementById(cursorId)?.remove();
    document.querySelectorAll('[data-b1-demo-cursor-ripple]').forEach((element) => element.remove());

    const element = document.createElement('div');
    element.id = cursorId;
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('data-demo-id', 'synthetic-cursor');
    Object.assign(element.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: `${sizePx}px`,
      height: `${sizePx}px`,
      zIndex: '2147483647',
      pointerEvents: 'none',
      filter: 'drop-shadow(0 2px 2px rgba(15, 23, 42, .38))',
      willChange: 'transform',
    });
    element.innerHTML = `
      <svg viewBox="0 0 32 32" width="100%" height="100%" style="display:block;overflow:visible">
        <path d="M4 2.5V25l6.1-6.1 5.2 10.4 5-2.5-5.2-10.1h8.7L4 2.5Z"
          fill="#ffffff" stroke="#111827" stroke-width="2.2" stroke-linejoin="round" />
      </svg>`;
    document.body.appendChild(element);

    const x = Math.max(24, window.innerWidth - sizePx * 2.8);
    const y = Math.max(24, window.innerHeight - sizePx * 2.8);
    element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    window.__b1DemoCursorState = {x, y};
  }, {cursorId: CURSOR_ID, sizePx: cursor.sizePx});
};

const moveCursorTo = async ({page, locator, durationMs}) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Cursor target has no visible bounding box');
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);

  await page.evaluate(async ({cursorId, x, y, durationMs}) => {
    const element = document.getElementById(cursorId);
    const state = window.__b1DemoCursorState;
    if (!element || !state) return;
    const distance = Math.hypot(x - state.x, y - state.y);
    if (distance < 2) return;
    const animation = element.animate([
      {transform: `translate3d(${state.x}px, ${state.y}px, 0)`},
      {transform: `translate3d(${x}px, ${y}px, 0)`},
    ], {
      duration: durationMs,
      easing: 'cubic-bezier(.22,.8,.25,1)',
      fill: 'forwards',
    });
    await animation.finished.catch(() => {});
    element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    window.__b1DemoCursorState = {x, y};
  }, {cursorId: CURSOR_ID, x, y, durationMs});
};

const showClickEffect = async ({page, durationMs}) => {
  await page.evaluate(({cursorId, durationMs}) => {
    const cursorElement = document.getElementById(cursorId);
    const state = window.__b1DemoCursorState;
    if (!cursorElement || !state) return;

    const ripple = document.createElement('div');
    ripple.setAttribute('data-b1-demo-cursor-ripple', '');
    Object.assign(ripple.style, {
      position: 'fixed',
      left: `${state.x}px`,
      top: `${state.y}px`,
      width: '28px',
      height: '28px',
      marginLeft: '-14px',
      marginTop: '-14px',
      border: '4px solid #6d5dfc',
      borderRadius: '999px',
      background: 'rgba(109, 93, 252, .14)',
      zIndex: '2147483646',
      pointerEvents: 'none',
    });
    document.body.appendChild(ripple);
    const animation = ripple.animate([
      {transform: 'scale(.35)', opacity: 1},
      {transform: 'scale(2.4)', opacity: 0},
    ], {duration: durationMs, easing: 'cubic-bezier(.16,.7,.3,1)'});
    animation.finished.finally(() => ripple.remove());
    cursorElement.querySelector('svg')?.animate([
      {transform: 'scale(1)'},
      {transform: 'scale(.78)'},
      {transform: 'scale(1)'},
    ], {duration: Math.min(240, durationMs), easing: 'ease-out'});
  }, {cursorId: CURSOR_ID, durationMs});
};

export const primeDemoCursor = async ({page, scene, cursor}) => {
  if (!cursor?.enabled) return;
  const firstPointerAction = scene.actions.find((action) => POINTER_ACTIONS.has(action.action) && action.target);
  if (!firstPointerAction) return;
  const scheduledMs = actionTimeMs(firstPointerAction, scene.cues, 0);
  if (scheduledMs > cursor.moveDurationMs + cursor.clickLeadMs) return;
  await moveCursorTo({
    page,
    locator: locatorFor(page, firstPointerAction.target),
    durationMs: cursor.moveDurationMs,
  });
};

const highlight = async (locator, durationMs) => {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate((element) => {
    element.dataset.b1DemoPreviousOutline = element.style.outline || '';
    element.dataset.b1DemoPreviousOutlineOffset = element.style.outlineOffset || '';
    element.style.outline = '6px solid #8b7cff';
    element.style.outlineOffset = '6px';
    element.style.borderRadius = element.style.borderRadius || '8px';
    element.animate([
      {boxShadow: '0 0 0 0 rgba(109,93,252,.8)'},
      {boxShadow: '0 0 0 22px rgba(109,93,252,0)'},
    ], {duration: 900, iterations: 2});
  });
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  await locator.evaluate((element) => {
    element.style.outline = element.dataset.b1DemoPreviousOutline || '';
    element.style.outlineOffset = element.dataset.b1DemoPreviousOutlineOffset || '';
  });
};

/**
 * How long the narration budgets for a timelapse wait: the gap between the
 * wait's own cue and the next explicitly-timed action after it. That is the
 * length the recorded wait is compressed to, so the footage that follows the
 * wait lands back on its cue. An author's `targetMs` overrides; with neither,
 * a wait becomes a brisk six seconds.
 */
const TIMELAPSE_DEFAULT_MS = 6000;
export const timelapseBudgetMs = (actions, index, cues) => {
  const explicit = actions[index].timelapse;
  if (explicit && typeof explicit === 'object' && explicit.targetMs) return explicit.targetMs;
  let plannedMs = 0;
  const planned = actions.map((action) => (plannedMs = Math.max(0, actionTimeMs(action, cues, plannedMs))));
  const next = actions.findIndex((action, i) => i > index && (action.atCue || action.atMs != null));
  if (next === -1) return TIMELAPSE_DEFAULT_MS;
  return Math.max(1000, planned[next] - planned[index]);
};

export const executeSceneActions = async ({page, scene, baseUrl, narrationStartTime, cursor}) => {
  let lastScheduledMs = 0;
  const timelapses = [];
  for (const [actionIndex, action] of scene.actions.entries()) {
    const scheduledMs = Math.max(0, actionTimeMs(action, scene.cues, lastScheduledMs));
    const timeout = action.timeoutMs || 10_000;
    const locator = action.target ? locatorFor(page, action.target) : null;
    const usesCursor = cursor?.enabled && locator && POINTER_ACTIONS.has(action.action);
    const clickLeadMs = CLICK_ACTIONS.has(action.action) ? cursor?.clickLeadMs || 0 : 0;

    if (usesCursor) {
      const moveStartMs = Math.max(0, scheduledMs - cursor.moveDurationMs - clickLeadMs);
      await waitUntil(narrationStartTime, moveStartMs);
      await moveCursorTo({page, locator, durationMs: cursor.moveDurationMs});
      if (clickLeadMs) {
        await waitUntil(narrationStartTime, Math.max(0, scheduledMs - clickLeadMs));
        await showClickEffect({page, durationMs: cursor.clickEffectDurationMs});
      }
    }
    await waitUntil(narrationStartTime, scheduledMs);

    switch (action.action) {
      case 'goto':
        await page.goto(resolveDemoUrl(action.route, baseUrl), {waitUntil: 'networkidle', timeout});
        await installDemoCursor(page, cursor);
        break;
      case 'click':
        await locator.click({timeout});
        break;
      case 'dblclick':
        await locator.dblclick({timeout});
        break;
      case 'fill':
        await locator.fill(action.value || '', {timeout});
        break;
      case 'type':
        // Character by character, so a prompt visibly being written reads as a
        // person writing it — fill is instant and looks like a paste.
        await locator.click({timeout});
        await locator.pressSequentially(action.value || '', {delay: action.delayMs ?? 35, timeout: Math.max(timeout, (action.value || '').length * (action.delayMs ?? 35) + 10_000)});
        break;
      case 'press':
        await locator.press(action.key || 'Enter', {timeout});
        break;
      case 'hover':
        await locator.hover({timeout});
        break;
      case 'highlight':
        await highlight(locator, action.durationMs || 1200);
        break;
      case 'waitFor': {
        const waitStartedMs = Date.now() - narrationStartTime;
        const waitDeadline = Date.now() + timeout;
        if (action.retry) {
          // A rescue click for live environments that fail transiently and
          // say so with a Retry button: keep polling for the real target, and
          // press Retry whenever it shows up — at most every everyMs.
          const retryLocator = locatorFor(page, action.retry.target).first();
          const everyMs = action.retry.everyMs || 45_000;
          let lastRetryAt = 0;
          for (;;) {
            if (await locator.first().isVisible().catch(() => false)) break;
            if (Date.now() > waitDeadline) throw new Error(`waitFor timed out after ${timeout}ms (${JSON.stringify(action.target)}, retry enabled)`);
            if (Date.now() - lastRetryAt >= everyMs && (await retryLocator.isVisible().catch(() => false))) {
              await retryLocator.click({timeout: 5000}).catch(() => {});
              lastRetryAt = Date.now();
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } else {
          // A visibility wait means "at least one match is visible" — a
          // selector that legitimately matches several elements (two cards
          // flipping to "Migrated" plus a toast) must not fail strict mode.
          await locator.first().waitFor({state: 'visible', timeout});
        }
        // A state that flickers — an agent's chip reading "Ready" between
        // steps — satisfies a plain visibility wait mid-flicker. stableMs
        // requires the target to still be there after riding out the flicker
        // window, and goes back to waiting when it is not.
        while (action.stableMs) {
          await new Promise((resolve) => setTimeout(resolve, action.stableMs));
          if (await locator.first().isVisible().catch(() => false)) break;
          await locator.first().waitFor({state: 'visible', timeout: Math.max(1000, waitDeadline - Date.now())});
        }
        if (action.timelapse) {
          const waitEndedMs = Date.now() - narrationStartTime;
          const targetMs = timelapseBudgetMs(scene.actions, actionIndex, scene.cues);
          // Only worth compressing when it saves something; a wait that
          // resolved inside its own budget plays back in real time.
          if (waitEndedMs - waitStartedMs > targetMs) timelapses.push({fromMs: waitStartedMs, toMs: waitEndedMs, targetMs});
        }
        break;
      }
      case 'screenshot':
        await page.screenshot({path: action.name || `screenshot-${Date.now()}.png`, fullPage: false});
        break;
      default:
        throw new Error(`Unsupported action ${action.action}`);
    }
    lastScheduledMs = Math.max(scheduledMs, Date.now() - narrationStartTime);
  }
  return {timelapses};
};

export const executeAssertions = async ({page, assertions}) => {
  for (const assertion of assertions) {
    if (assertion.visible) {
      // Same rule as waitFor: proof that at least one match rendered.
      await locatorFor(page, assertion.visible).first().waitFor({state: 'visible', timeout: 10_000});
      continue;
    }
    if (assertion.textContains) {
      const text = await locatorFor(page, assertion.textContains.target).innerText({timeout: 10_000});
      if (!text.includes(assertion.textContains.value)) {
        throw new Error(`Expected text ${JSON.stringify(assertion.textContains.value)} in ${JSON.stringify(text)}`);
      }
    }
  }
};
