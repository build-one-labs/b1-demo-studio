import assert from 'node:assert/strict';
import test from 'node:test';
import {loadDemo} from '../src/lib/files.mjs';

test('sales tour planning demo validates', async () => {
  const {demo} = await loadDemo('sales-tour-planning');
  assert.equal(demo.settings.viewport.width, 1920);
  assert.equal(demo.settings.viewport.height, 1080);
  assert.equal(demo.settings.cursor.enabled, true);
  // The recording runs against the workspace's own web app by default; a
  // hard-coded deployed URL here would silently record someone else's data.
  assert.equal(demo.settings.baseUrl.fallback, 'http://localhost:8080/');
  // English is the company language — a German scene sneaking in would be
  // narrated in German by the voice clone without any error.
  assert.equal(demo.settings.language, 'en');
});

test('opportunities map demo validates', async () => {
  const {demo} = await loadDemo('opportunities-map');
  assert.equal(demo.settings.language, 'en');
  // Same guard as above, plus the app query: OpportunitiesMapScreen lives in
  // the mini-apps module, which belongs to the `sample-app` product. Drop the
  // query and every scene records the default app's screen list instead.
  assert.equal(demo.settings.baseUrl.fallback, 'http://localhost:8080/?app=sample-app');
  // Each scene must stand alone — the recorder gives every one a fresh context.
  for (const scene of demo.scenes) {
    assert.equal(scene.route, '/screens/OpportunitiesMapScreen');
    assert.ok(scene.assertions.length > 0, `scene ${scene.id} has no assertion`);
  }
});
