import type { Page, Response } from '@playwright/test';

/**
 * Base class for all page objects.
 *
 * Holds the Playwright `page` handle and a couple of navigation helpers so
 * concrete page objects only need to declare their own locators and actions.
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /** Navigate to a path relative to the configured `baseURL`. */
  async goto(path = '/'): Promise<Response | null> {
    return this.page.goto(path);
  }

  /**
   * Wait until the screen is ready to act on.
   *
   * Two waits, because neither alone is right. The rendering engine stamps
   * `data-repository-instance-name` on every blueprint object it mounts, so the
   * first one appearing is positive proof that the screen blueprint arrived and
   * rendered — the thing a test needs and the thing a cold route (the stack runs
   * in dev mode, compiling on first visit) makes slow. `networkidle` then lets
   * the initial fetch land, but it is a convenience and not a contract: screens
   * hold a socket open, galleries poll and an agent chat streams, so on those it
   * never goes quiet.
   *
   * Neither failure is raised from here. A helper that throws reports a timeout
   * in a navigation call instead of whatever the test set out to check; the
   * caller's own assertions retry and say something useful when a screen really
   * did not come up.
   */
  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await this.page
      .locator('[data-repository-instance-name]')
      .first()
      .waitFor({ state: 'attached', timeout: 30_000 })
      .catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  }
}
