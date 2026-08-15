import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import {chromium} from '@playwright/test';
import {loadDotEnv} from '../src/lib/env.mjs';

// src/cli.mjs loads demo-factory/.env for every pipeline stage; these auth
// tools are separate entry points and were reading process.env raw, so a
// B1_BASE_URL set in that .env reached the pipeline but never the login.
await loadDotEnv();

const baseUrl = process.env.B1_BASE_URL;
if (!baseUrl) throw new Error('Set B1_BASE_URL before capturing authentication state');
const authFile = path.resolve('playwright/.auth/b1-demo-user.json');
await mkdir(path.dirname(authFile), {recursive: true});

// Headed, but the same browser rule as b1-auth-state.mjs: use the system
// Chromium where one was configured rather than Playwright's managed download.
const browser = await chromium.launch({headless: false, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(baseUrl, {waitUntil: 'domcontentloaded'});

const prompt = createInterface({input, output});
try {
  await prompt.question('Melde dich im geöffneten Browser als Demo-Benutzer an und drücke anschließend Enter ... ');
  await context.storageState({path: authFile});
  console.log(`Auth State written to ${authFile}. This file is gitignored and must be treated as a secret.`);
} finally {
  prompt.close();
  await browser.close();
}

