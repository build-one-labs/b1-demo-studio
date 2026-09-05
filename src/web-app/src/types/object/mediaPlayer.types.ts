import type { ObjectAttributes, ObjectBlueprint, ObjectInstance } from '@buildone/web-core';
import type { Ref } from 'vue';

/** Blueprint attributes of a `b1_media_player` (issue #17). */
export interface MediaPlayerAttributes extends ObjectAttributes {
  headerLabel: string;
  /** Field of the bound record holding the media URL. */
  srcField: string;
  /** Field of the bound record holding the captions (SRT) URL. */
  captionsField: string;
  htmlClass: string;
}

export type MediaPlayerBlueprint = ObjectBlueprint<MediaPlayerAttributes>;

/** The instance as its composable augments it — what a timeline on the same screen reads and drives. */
export interface MediaPlayer extends ObjectInstance<MediaPlayerBlueprint> {
  /** The record the player follows — the data source's cursor record. */
  record: Ref<Record<string, unknown> | undefined>;
  /** Where playback is, in milliseconds; written by the component. */
  currentTimeMs: Ref<number>;
  /** The media's length once known, in milliseconds; written by the component. */
  mediaDurationMs: Ref<number>;
  /** A position to jump to; the component consumes it. */
  seekRequestMs: Ref<number | null>;
  seek(ms: number): void;
}
