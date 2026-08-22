/**
 * Probe: can we sign in to a deployed app headlessly with email/password, and
 * if so, save the Playwright storage state for recording?
 *
 * Usage:
 *   B1_LOGIN_EMAIL=... B1_LOGIN_PASSWORD=... node tools/probe-password-login.mjs <base-url> [--save=<file>]
 */
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';

const args = process.argv.slice(2);
const baseUrl = args.find((a) => !a.startsWith('--'));
const saveTo = args.find((a) => a.startsWith('--save='))?.slice('--save='.length) || '';
const email = process.env.B1_LOGIN_EMAIL || '';
const password = process.env.B1_LOGIN_PASSWORD || '';
if (!baseUrl || !email || !password) throw new Error('Usage: B1_LOGIN_EMAIL=... B1_LOGIN_PASSWORD=... node tools/probe-password-login.mjs <base-url> [--save=file]');

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const browser = await chromium.launch({headless: true, executablePath});
const context = await browser.newContext({viewport: {width: 1920, height: 1080}});
const page = await context.newPage();
try {
  await page.goto(baseUrl, {waitUntil: 'networkidle', timeout: 45_000});
  console.log(`landed on ${page.url()}`);
  if (!page.url().includes('sign-in')) {
    console.log('No sign-in page — nothing to probe.');
  } else {
    await page.locator('input[type="email"], input[name="email"], input[autocomplete*="username"], input[type="text"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")').first().click();
    await page.waitForLoadState('networkidle', {timeout: 45_000}).catch(() => {});
    console.log(`after submit: ${page.url()}`);
    const ready = await page
      .locator('[data-demo-id="app-ready"], .b1-shell-row')
      .first()
      .waitFor({state: 'visible', timeout: 25_000})
      .then(() => true, () => false);
    const errorText = await page.locator('.p-toast-message, [class*="error"]').first().innerText().catch(() => '');
    console.log(ready ? 'VERDICT: signed in — app shell rendered' : `VERDICT: sign-in failed (${errorText.slice(0, 200) || 'no visible error'})`);
    if (ready && saveTo) {
      await mkdir(path.dirname(saveTo), {recursive: true});
      await context.storageState({path: saveTo});
      console.log(`storage state saved to ${saveTo}`);
    }
  }
  await page.screenshot({path: 'output/probe-login.png'}).catch(() => {});
} finally {
  await browser.close();
}
