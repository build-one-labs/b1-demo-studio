import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

/**
 * Extended Playwright test with page objects exposed as fixtures.
 *
 * Import `{test, expect}` from this module instead of `@playwright/test` so
 * specs get ready-instantiated page objects:
 *
 *   import {test, expect} from '../../fixtures/test';
 *   test('...', async ({loginPage}) => { ... });
 *
 * Add each new page object in three places: the class under `pages/`, a field
 * on `Fixtures`, and a factory below. A spec then names it as an argument and
 * never constructs one itself.
 */
interface Fixtures {
  loginPage: LoginPage;
}

export const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  }
});

export { expect } from '@playwright/test';
