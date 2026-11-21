import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the sign-in screen (`/sign-in`, rendered by B1Login.vue).
 *
 * The login form has no `data-testid` attributes, so locators rely on the
 * stable `name` attributes and the single `type="submit"` button (the social
 * login buttons use click handlers, not submit).
 *
 * OAuth providers are configured records rather than a fixed set — a
 * deployment may offer several of one type — so their buttons are addressed by
 * provider id through `providerButton()`.
 */
export class LoginPage extends BasePage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  /**
   * Per-method controls. The three conventional OAuth ids are kept here
   * because their test ids predate configurable providers; address any other
   * provider through `providerButton()`.
   */
  readonly methodButtons: Record<'basic' | 'guest' | 'google' | 'microsoft' | 'github', Locator>;
  readonly signUpLink: Locator;
  readonly forgotPasswordLink: Locator;
  /** "You've been invited" — a platform invitation link. */
  readonly invitationBanner: Locator;
  /** "Welcome back", or the join screen's invitation title. */
  readonly title: Locator;
  /** The join screen's intro: an organization invitation link. */
  readonly invitationIntro: Locator;
  /** The join screen's choice between creating an account and signing in. */
  readonly modeToggle: Locator;
  readonly createAccountMode: Locator;
  readonly signInMode: Locator;
  /** Name field, asked for when the join screen creates an account without onboarding. */
  readonly nameInput: Locator;
  /** The compact locale dropdown in the card's top corner. */
  readonly languageSwitcher: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInput = page.locator('input[name="email"]');
    this.passwordInput = page.locator('input[name="password"]');
    this.submitButton = page.locator('button[type="submit"]');
    this.signUpLink = page.getByTestId('login-signup');
    this.forgotPasswordLink = page.getByTestId('login-forgot');
    this.invitationBanner = page.getByTestId('login-invitation-banner');
    this.title = page.getByTestId('login-title');
    this.invitationIntro = page.getByTestId('login-invitation-intro');
    this.modeToggle = page.getByTestId('login-mode');
    this.createAccountMode = page.getByTestId('login-mode-signUp');
    this.signInMode = page.getByTestId('login-mode-signIn');
    this.nameInput = page.locator('input[name="name"]');
    this.languageSwitcher = page.getByTestId('auth-language-switcher');
    this.methodButtons = {
      basic: this.submitButton,
      guest: page.getByTestId('login-guest'),
      google: page.getByTestId('login-google'),
      microsoft: page.getByTestId('login-microsoft'),
      github: page.getByTestId('login-github')
    };
    this.organizationName = page.getByTestId('login-organization');
    this.organizationLogo = page.getByTestId('login-organization-logo');
    this.generalSignInLink = page.getByTestId('login-general-sign-in').getByRole('link');
  }

  /**
   * The sign-in button for one configured provider. The three conventional ids
   * kept the test ids the fixed buttons had; every other provider — a second
   * Microsoft tenant, say — uses the general `login-provider-<id>` form.
   */
  providerButton(providerId: string): Locator {
    const conventional: Record<string, string> = {
      microsoft: 'login-microsoft',
      google: 'login-google',
      github: 'login-github'
    };
    return this.page.getByTestId(conventional[providerId] ?? `login-provider-${providerId}`);
  }

  /** The organization's name on its own sign-in screen (`/sign-in/<slug>`). */
  readonly organizationName: Locator;
  /** The organization's logo, above the product's, on its own screen. */
  readonly organizationLogo: Locator;
  /** On an organization's screen, the way to the deployment's own `/sign-in`. */
  readonly generalSignInLink: Locator;

  /** Open the sign-in screen. */
  async open(): Promise<void> {
    await this.goto('/sign-in');
    await this.emailInput.waitFor({ state: 'visible' });
  }

  /**
   * Open one organization's own sign-in screen — the address a customer points
   * their people at, and configures as their app's login URL.
   */
  async openOrganization(slug: string): Promise<void> {
    await this.goto(`/sign-in/${slug}`);
    await this.page.getByTestId('login-screen').waitFor({ state: 'visible' });
  }

  /**
   * Open the sign-in screen without assuming the password form is on it — an
   * administrator may have switched password sign-in off.
   */
  async openAnyMethod(): Promise<void> {
    await this.goto('/sign-in');
    await this.page.getByTestId('login-screen').waitFor({ state: 'visible' });
  }

  /**
   * Open a link that ends on the sign-in screen (an invitation link to the app
   * root, say) and wait for it, without assuming the password form is on it.
   */
  async openViaLink(path: string): Promise<void> {
    await this.goto(path);
    await this.page.getByTestId('login-screen').waitFor({ state: 'visible', timeout: 30_000 });
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
