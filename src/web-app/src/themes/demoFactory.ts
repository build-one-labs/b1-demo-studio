import { UltimaPreset } from '@buildone/web-framework-layer/src/themes/ultima';
import { definePreset } from '@primeuix/themes';

/**
 * "Demo Factory" — the theme of the b1-demo-factory app (its b1_app `theme`),
 * registered by plugins/themes.client.ts. Every other app keeps the default.
 *
 * It is "Build.One Ultima" in the colours of the Studio's own pages, the film
 * strips and the welcome panel: an amber primary instead of Build.One blue,
 * warm stone greys instead of slate, and an almost black, warm taskbar instead
 * of navy — the projection booth around the screen.
 *
 * Light scheme: the primary is amber 600 (#b86e00), dark enough to carry white
 * text and to read as a link on white. Dark scheme: the bright amber 400
 * (#f5b33c) with dark text, as on the welcome panel's New demo button.
 */
const reel = {
  50: '#fffaeb',
  100: '#fef0c7',
  200: '#fde08a',
  300: '#fbc94d',
  400: '#f5b33c',
  500: '#e8961a',
  600: '#b86e00',
  700: '#8f5300',
  800: '#6f4105',
  900: '#5a3508',
  950: '#331c02'
};

const stone = {
  0: '#ffffff',
  50: '{stone.50}',
  100: '{stone.100}',
  200: '{stone.200}',
  300: '{stone.300}',
  400: '{stone.400}',
  500: '{stone.500}',
  600: '{stone.600}',
  700: '{stone.700}',
  800: '{stone.800}',
  900: '{stone.900}',
  950: '{stone.950}'
};

/** The taskbar: warm near-black film base rather than Ultima's navy. */
const TASKBAR_BACKGROUND = '#17130e';

export const DemoFactoryPreset = definePreset(UltimaPreset, {
  primitive: { reel },
  semantic: {
    primary: {
      50: '{reel.50}',
      100: '{reel.100}',
      200: '{reel.200}',
      300: '{reel.300}',
      400: '{reel.400}',
      500: '{reel.500}',
      600: '{reel.600}',
      700: '{reel.700}',
      800: '{reel.800}',
      900: '{reel.900}',
      950: '{reel.950}'
    },
    colorScheme: {
      light: {
        surface: stone,
        primary: {
          color: '{primary.600}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.700}',
          activeColor: '{primary.800}'
        },
        highlight: {
          background: '{primary.50}',
          focusBackground: '{primary.100}',
          color: '{primary.800}',
          focusColor: '{primary.900}'
        }
      },
      dark: {
        surface: stone,
        primary: {
          color: '{primary.400}',
          contrastColor: '#1a1305',
          hoverColor: '{primary.300}',
          activeColor: '{primary.200}'
        },
        highlight: {
          background: 'color-mix(in srgb, {primary.400}, transparent 84%)',
          focusBackground: 'color-mix(in srgb, {primary.400}, transparent 76%)',
          color: 'rgba(255, 255, 255, 0.87)',
          focusColor: 'rgba(255, 255, 255, 0.87)'
        }
      }
    }
  },
  extend: {
    b1: {
      taskbar: {
        background: TASKBAR_BACKGROUND
      }
    }
  }
});
