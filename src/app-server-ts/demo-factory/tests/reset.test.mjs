import assert from 'node:assert/strict';
import test from 'node:test';
import {demoSchema} from '../src/schema.mjs';
import {RESET_REPOSITORY_PATH} from '../src/lib/reset.mjs';

const settings = {
  viewport: {width: 1920, height: 1080},
  baseUrl: {env: '', fallback: 'https://samples.demo.build.one/?app=b1-labs'},
  narration: {voiceIdEnv: 'V', apiKeyEnv: 'K', modelIdEnv: 'M', defaultModelId: 'm', languageCodeEnv: 'L', defaultLanguageCode: 'de'},
  branding: {productName: 'Build.One', accentColor: '#1266f1', backgroundColor: '#0b1020', textColor: '#fff'},
};
const demo = (extra = {}) => demoSchema.parse({schemaVersion: 1, id: 'd', title: 'D', settings: {...settings, ...extra}, scenes: [{id: 'a', title: 'A', route: '/', narration: 'Text.'}]});

test('the repository reset is off unless a demo asks for it', () => {
  assert.equal(demo().settings.resetRepository, false);
  assert.equal(demo({resetRepository: true}).settings.resetRepository, true);
});

test("the reset goes to the application's own origin, whatever path or app the base URL names", () => {
  assert.equal(new URL(RESET_REPOSITORY_PATH, settings.baseUrl.fallback).href, 'https://samples.demo.build.one/service/swat/server-actions/repository/modified-objects/reset-repository');
});
