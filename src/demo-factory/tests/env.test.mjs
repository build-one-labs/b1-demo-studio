import assert from 'node:assert/strict';
import test from 'node:test';
import {authHostSlug, resolveApiKey} from '../src/lib/env.mjs';

test('An auth server URL becomes the fragment its API key is named for', () => {
  assert.equal(authHostSlug('https://try-auth.test.build.one'), 'TRY_AUTH_TEST_BUILD_ONE');
  assert.equal(authHostSlug('http://auth_server:3000/'), 'AUTH_SERVER');
  assert.equal(authHostSlug('https://user:pass@auth.example.com/path?x=1'), 'AUTH_EXAMPLE_COM');
  assert.equal(authHostSlug(''), null);
  assert.equal(authHostSlug(undefined), null);
});

test('The key scoped to this auth server wins over the unqualified one', () => {
  const env = {
    B1_USER_API_KEY: 'unqualified',
    B1_USER_API_KEY__TRY_AUTH_TEST_BUILD_ONE: 'scoped',
  };
  assert.deepEqual(resolveApiKey(env, 'https://try-auth.test.build.one'), {
    name: 'B1_USER_API_KEY__TRY_AUTH_TEST_BUILD_ONE',
    key: 'scoped',
  });
});

test('The unqualified key is a fallback, not the contract', () => {
  const env = {B1_USER_API_KEY: 'typed-into-settings'};
  assert.deepEqual(resolveApiKey(env, 'https://try-auth.test.build.one'), {
    name: 'B1_USER_API_KEY',
    key: 'typed-into-settings',
  });
  assert.deepEqual(resolveApiKey(env, undefined), {name: 'B1_USER_API_KEY', key: 'typed-into-settings'});
});

// The whole point of scoping: a key minted by some other auth server cannot
// sign this recording in, so it must not read as "this host can authenticate".
test('A key for another auth server does not count', () => {
  const env = {B1_USER_API_KEY__AUTH_DEVELOP_TEST_BUILD_ONE: 'wrong-server'};
  assert.equal(resolveApiKey(env, 'https://try-auth.test.build.one'), null);
});

test('An empty value is no key at all', () => {
  assert.equal(resolveApiKey({B1_USER_API_KEY: ''}, 'https://try-auth.test.build.one'), null);
});
