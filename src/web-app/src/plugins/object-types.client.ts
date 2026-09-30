/**
 * The Studio's own panel-level object types.
 *
 * The runtime resolves a blueprint instance to a component through the object
 * type's `uiComponentAlias`; the strings below are those aliases, and the only
 * coupling between the metadata in the blueprint database and this code (see
 * .claude/skills/b1-implement-object-type). The two data-bound types register a
 * composable as well, which subscribes to their DATA link when the instance is
 * created — before any component mounts, so nothing published early is lost.
 * The log view keeps its state in the component and needs none.
 *
 * Client-only: the object factory registry lives in the browser bundle.
 */
import { registerNewObjectType, registerNewObjectTypeComponent } from '@buildone/web-core';

import useDemoTimeline from '~/composables/useDemoTimeline';
import useMediaPlayer from '~/composables/useMediaPlayer';

export default defineNuxtPlugin(() => {
  registerNewObjectTypeComponent('logView', () => import('~/components/B1LogView.vue'));

  registerNewObjectType('mediaPlayer', useMediaPlayer);
  registerNewObjectTypeComponent('mediaPlayer', () => import('~/components/B1MediaPlayer.vue'));

  registerNewObjectType('demoTimeline', useDemoTimeline);
  registerNewObjectTypeComponent('demoTimeline', () => import('~/components/B1DemoTimeline.vue'));
});
