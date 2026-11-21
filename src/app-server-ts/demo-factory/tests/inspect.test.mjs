import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectRequestSchema, inspectStartUrl} from '../src/lib/inspect.mjs';

const demo = {settings: {baseUrl: {env: 'B1_BASE_URL', fallback: 'https://samples.demo.build.one/?app=b1-labs'}}};

test('an inspection opens an absolute URL, else a route against its application, else the demo base URL', () => {
  assert.equal(inspectStartUrl(demo, {url: 'https://platform.demo.build.one/screens/X'}, {}), 'https://platform.demo.build.one/screens/X');
  assert.equal(inspectStartUrl(demo, {route: '/screens/Invoices'}, {}), 'https://samples.demo.build.one/screens/Invoices?app=b1-labs');
  assert.equal(inspectStartUrl(demo, {route: '/', baseUrl: 'https://platform.demo.build.one/'}, {}), 'https://platform.demo.build.one/');
  assert.equal(inspectStartUrl(demo, {}, {B1_BASE_URL: 'http://caddy:8080/'}), 'http://caddy:8080/');
});

test('an inspection request takes scene actions and assertions, and nothing unknown', () => {
  const request = inspectRequestSchema.parse({
    route: '/',
    actions: [{action: 'click', target: {role: 'button', name: 'Finance'}}],
    assertions: [{visible: {text: 'List of Invoices'}}],
  });
  assert.equal(request.actions.length, 1);
  assert.throws(() => inspectRequestSchema.parse({actions: [{action: 'explode'}]}));
  assert.throws(() => inspectRequestSchema.parse({script: 'alert(1)'}));
  assert.deepEqual(inspectRequestSchema.parse({}), {actions: [], assertions: []});
});
