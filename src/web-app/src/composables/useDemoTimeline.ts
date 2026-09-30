import { ref } from 'vue';

import type { ObjectInstance } from '@buildone/web-core';
import type { DemoTimeline, DemoTimelineBlueprint } from '~/types/object/demoTimeline.types';

/**
 * The runtime state of a `b1_demo_timeline`: the bound scene records and the
 * selected one. Subscribed at instance creation so a Join that fires before
 * the tab is opened is not missed.
 */
export default function useDemoTimeline(object: ObjectInstance<DemoTimelineBlueprint>): DemoTimeline {
  const records = ref<Record<string, unknown>[]>([]);
  const selectedRecord = ref<Record<string, unknown> | undefined>();

  object.linkStore.subscribe<Record<string, unknown>[]>('DATA', 'dataAvailable', ({ payload }) => {
    records.value = Array.isArray(payload) ? payload : [];
  });
  object.linkStore.subscribe<{ selectedRecord: Record<string, unknown> | undefined }>(
    'DATA',
    'cursorChange',
    ({ payload }) => {
      selectedRecord.value = payload?.selectedRecord;
    }
  );

  return Object.assign(object, { records, selectedRecord });
}
