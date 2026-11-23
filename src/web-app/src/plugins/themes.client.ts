import { registerAppTheme } from '@buildone/web-core';

import { DemoFactoryPreset } from '../themes/demoFactory';

/**
 * The repository's own themes, next to the framework's in the theme switcher.
 *
 * "Demo Factory" is the theme of the b1-demo-factory app (its b1_app `theme`
 * attribute); a user can still pick another one for the app in the switcher.
 */
export default defineNuxtPlugin({
  name: 'app-themes',
  setup() {
    registerAppTheme('Demo Factory', DemoFactoryPreset);
  }
});
