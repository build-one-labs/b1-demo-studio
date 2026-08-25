import { test, expect } from '../../fixtures/test';

/**
 * Smoke test: with a reused authenticated session, the app shell loads at the
 * root and produces no uncaught console/page errors. This is the minimal
 * end-to-end signal that auth + app rendering work together.
 */
test.describe('App smoke', () => {
  test('home loads authenticated with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // We must not have been bounced back to the sign-in screen.
    await expect(page).not.toHaveURL(/\/sign-in/);
    // The app shell rendered something.
    await expect(page.locator('body')).toBeVisible();

    expect(errors, `Console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
