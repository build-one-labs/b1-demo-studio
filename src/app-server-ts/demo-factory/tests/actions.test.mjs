import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveDemoUrl} from '../src/lib/actions.mjs';

test('B1 app query is preserved while resolving scene routes', () => {
  assert.equal(
    resolveDemoUrl('/object-types', 'https://vanguard-develop.test.build.one/?app=b1-vibecode'),
    'https://vanguard-develop.test.build.one/object-types?app=b1-vibecode',
  );
});

test('an explicit route query overrides the base query', () => {
  assert.equal(
    resolveDemoUrl('/object-types?app=another-app', 'https://vanguard-develop.test.build.one/?app=b1-vibecode'),
    'https://vanguard-develop.test.build.one/object-types?app=another-app',
  );
});
