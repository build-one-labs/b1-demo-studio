import type { ObjectAttributes, ObjectBlueprint, ObjectInstance } from '@buildone/web-core';
import type { Ref } from 'vue';

/** Blueprint attributes of a `b1_demo_timeline` (issue #17). */
export interface DemoTimelineAttributes extends ObjectAttributes {
  headerLabel: string;
  /** Instance name of the b1_media_player on the same screen to follow and seek. */
  playerObject: string;
  /** Field of each record holding its length in milliseconds. */
  durationField: string;
  /** Field of each record holding its cue markers as { name: offsetMs }. */
  cuesField: string;
  htmlClass: string;
}

export type DemoTimelineBlueprint = ObjectBlueprint<DemoTimelineAttributes>;

export interface DemoTimeline extends ObjectInstance<DemoTimelineBlueprint> {
  /** The bound records — the scenes of the run, in their data source's order. */
  records: Ref<Record<string, unknown>[]>;
  selectedRecord: Ref<Record<string, unknown> | undefined>;
}
