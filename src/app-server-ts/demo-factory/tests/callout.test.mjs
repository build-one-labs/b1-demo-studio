import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {chromium} from 'playwright';
import YAML from 'yaml';
import {executeSceneActions, showCallout} from '../src/lib/actions.mjs';
import {validateDemoSemantics} from '../src/lib/files.mjs';
import {demoSchema} from '../src/schema.mjs';

test('callouts validate without a target and require explicit text', async () => {
  const demo = YAML.parse(await readFile(new URL('../demos/opportunities-map/demo.yaml', import.meta.url), 'utf8'));
  demo.scenes[0].actions = [{action: 'callout', value: 'Your account. Your permissions.'}, {action: 'callout', value: ''}];
  validateDemoSemantics(demoSchema.parse(demo));
  delete demo.scenes[0].actions[0].value;
  assert.equal(demoSchema.safeParse(demo).success, false);
});

test('callouts render literal text, replace safely, expire and clear through actions', async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    await page.setContent('<button>Still clickable</button>');
    await showCallout(page, '<b>Literal text</b>');
    assert.equal(await page.locator('#__b1-demo-callout').innerText(), '<b>Literal text</b>');
    assert.equal(await page.locator('#__b1-demo-callout b').count(), 0);
    await showCallout(page, 'Old banner', 80);
    await showCallout(page, 'Replacement');
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#__b1-demo-callout').innerText(), 'Replacement');
    assert.equal(await page.locator('#__b1-demo-callout').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await showCallout(page, 'Temporary', 20);
    await page.locator('#__b1-demo-callout').waitFor({state: 'detached'});
    await showCallout(page, 'Last');
    await executeSceneActions({page, scene: {actions: [{action: 'callout', value: ''}], cues: {}}, narrationStartTime: Date.now(), cursor: {enabled: false}});
    assert.equal(await page.locator('#__b1-demo-callout').count(), 0);
  } finally {await browser.close();}
});
