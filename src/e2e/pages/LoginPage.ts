import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the sign-in screen (`/sign-in`, rendered by B1Login.vue).
 *
 * The login form has no `data-testid` attributes, so locators rely on the
 * stable `name` attributes and the single `type="submit"` button (the social
 * login buttons use click handlers, not submit).
 */
export class LoginPage extends BasePage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  /** Per-method controls, keyed like `applicationSettings.authentication.validAuthentications`. */
  readonly methodButtons: Record<'basic' | 'guest' | 'google' | 'microsoft' | 'github', Locator>;
  readonly signUpLink: Locator;
  readonly forgotPasswordLink: Locator;
  /** The compact locale dropdown in the card's top corner. */
  readonly languageSwitcher: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInput = page.locator('input[name="email"]');
    this.passwordInput = page.locator('input[name="password"]');
    this.submitButton = page.locator('button[type="submit"]');
    this.signUpLink = page.getByTestId('login-signup');
    this.forgotPasswordLink = page.getByTestId('login-forgot');
    this.languageSwitcher = page.getByTestId('auth-language-switcher');
    this.methodButtons = {
      basic: this.submitButton,
      guest: page.getByTestId('login-guest'),
      google: page.getByTestId('login-google'),
      microsoft: page.getByTestId('login-microsoft'),
      github: page.getByTestId('login-github')
    };
  }

  /** Open the sign-in screen. */
  async open(): Promise<void> {
    await this.goto('/sign-in');
    await this.emailInput.waitFor({ state: 'visible' });
  }

  /**
   * Open the sign-in screen without assuming the password form is on it —
   * `B1_VALID_AUTHENTICATIONS` may have switched `basic` off.
   */
  async openAnyMethod(): Promise<void> {
    await this.goto('/sign-in');
    await this.page.getByTestId('login-screen').waitFor({ state: 'visible' });
  }

  /** Fill the credentials, submit, and wait until we leave `/sign-in`. */
  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
    await this.page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
      timeout: 30_000
    });
  }
}
