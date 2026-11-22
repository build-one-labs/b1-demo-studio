import assert from 'node:assert/strict';
import test from 'node:test';
import {demoOrigins, scopeApiKey} from '../src/lib/credentials.mjs';

const demo = {
  settings: {baseUrl: {env: 'B1_BASE_URL', fallback: 'https://samples.demo.build.one/?app=b1-labs'}},
  scenes: [{id: 'a'}, {id: 'b', baseUrl: 'https://platform.demo.build.one/'}],
};

test("a demo's origins are its own application and every scene's", () => {
  assert.deepEqual([...demoOrigins(demo, {})], ['https://samples.demo.build.one', 'https://platform.demo.build.one']);
  assert.deepEqual([...demoOrigins(demo, {B1_BASE_URL: 'http://caddy:8080/'})], ['http://caddy:8080', 'https://platform.demo.build.one']);
});

test('the API key goes only to the demo applications', async () => {
  let handler;
  const context = {route: async (_pattern, callback) => {handler = callback;}};
  await scopeApiKey(context, 'secret', demoOrigins(demo, {}));
  const sent = async (url) => {
    let headers;
    await handler({request: () => ({url: () => url, headers: () => ({accept: '*/*'})}), continue: async (options) => {headers = options?.headers;}});
    return headers?.['x-api-key'];
  };
  assert.equal(await sent('https://samples.demo.build.one/service/app/x'), 'secret');
  assert.equal(await sent('https://platform.demo.build.one/screens/Y'), 'secret');
  assert.equal(await sent('https://fonts.example.com/font.woff2'), undefined);
  assert.equal(await sent('data:image/png;base64,AAAA'), undefined);
});

test('without a key the context is left alone', async () => {
  let routed = false;
  await scopeApiKey({route: async () => {routed = true;}}, undefined, new Set());
  assert.equal(routed, false);
});
