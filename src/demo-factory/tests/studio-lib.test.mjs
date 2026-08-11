import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {assertSafeId, buildJobCommand, publicSettings, safeChildPath} from '../studio/lib.mjs';

test('Studio accepts safe demo ids and rejects command-like ids', () => {
  assert.equal(assertSafeId('vibecode-sales-tour'), 'vibecode-sales-tour');
  assert.throws(() => assertSafeId('../secrets'), /Invalid/);
  assert.throws(() => assertSafeId('demo;whoami'), /Invalid/);
});

test('Studio builds shell-free CLI arguments for a selective recording', () => {
  assert.deepEqual(buildJobCommand({
    action: 'record',
    demoId: 'payment-infrastructure',
    scenes: ['golden-path', 'typed-connections'],
  }), {
    script: 'src/cli.mjs',
    args: ['record', 'payment-infrastructure', '--scenes=golden-path,typed-connections'],
    step: 'record',
    needsFixture: true,
  });
});

test('Studio does not expose secret values in public settings', () => {
  const settings = publicSettings({ELEVENLABS_API_KEY: 'secret-value', B1_BASE_URL: 'https://example.test'});
  assert.deepEqual(settings.ELEVENLABS_API_KEY, {configured: true, secret: true});
  assert.equal(settings.B1_BASE_URL.value, 'https://example.test');
});

test('Studio media paths remain below their configured root', () => {
  const root = path.resolve('output', 'demo');
  assert.equal(safeChildPath(root, 'run', 'video.mp4'), path.join(root, 'run', 'video.mp4'));
  assert.throws(() => safeChildPath(root, '..', 'secret.txt'), /escapes/);
});
