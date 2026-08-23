/**
 * Answers one question before anyone records: does this base URL accept the
 * given credentials headlessly, the exact way record.mjs will use them?
 *
 * Same context recipe as record.mjs — extraHTTPHeaders x-api-key, or a
 * storage state — then one navigation, and a verdict from what actually
 * rendered: the app shell (`.b1-shell-row` / `[data-demo-id="app-ready"]`),
 * or the sign-in page.
 *
 * Usage:
 *   node tools/probe-auth.mjs <base-url> [--api-key=<key>] [--auth-state=<file>]
 */
import {chromium} from '@playwright/test';

const args = process.argv.slice(2);
const baseUrl = args.find((a) => !a.startsWith('--'));
if (!baseUrl) throw new Error('Usage: node tools/probe-auth.mjs <base-url> [--api-key=...] [--auth-state=...]');
const apiKey = args.find((a) => a.startsWith('--api-key='))?.slice('--api-key='.length) || process.env.B1_USER_API_KEY || '';
const authState = args.find((a) => a.startsWith('--auth-state='))?.slice('--auth-state='.length) || '';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const browser = await chromium.launch({headless: true, executablePath});
const context = await browser.newContext({
  viewport: {width: 1920, height: 1080},
  ...(authState ? {storageState: authState} : {}),
  ...(apiKey && !authState ? {extraHTTPHeaders: {'x-api-key': apiKey}} : {}),
});
const page = await context.newPage();
console.log(`Probing ${baseUrl} (${authState ? `storage state ${authState}` : apiKey ? 'x-api-key header' : 'no credentials'})`);
try {
  const response = await page.goto(baseUrl, {waitUntil: 'networkidle', timeout: 45_000});
  console.log(`HTTP ${response?.status()} — landed on ${page.url()}`);
  const ready = await page
    .locator('[data-demo-id="app-ready"], .b1-shell-row')
    .first()
    .waitFor({state: 'visible', timeout: 20_000})
    .then(() => true, () => false);
  const signIn = page.url().includes('sign-in') || (await page.locator('input[type="password"]').count()) > 0;
  const title = await page.title().catch(() => '');
  console.log(`title: ${title}`);
  console.log(ready ? 'VERDICT: authenticated — app shell rendered' : signIn ? 'VERDICT: NOT authenticated — sign-in page' : 'VERDICT: unclear — neither shell nor sign-in found');
  await page.screenshot({path: 'output/probe-auth.png'}).catch(() => {});
} finally {
  await browser.close();
}
