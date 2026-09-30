import { ref } from 'vue';

import type { ObjectInstance } from '@buildone/web-core';
import type { MediaPlayer, MediaPlayerBlueprint } from '~/types/object/mediaPlayer.types';

/**
 * The runtime state of a `b1_media_player`.
 *
 * Subscribed here rather than in the component because the data source may
 * publish before the component mounts (a tab that is not yet open) — the
 * composable is created with the instance and misses nothing. Playback
 * position and length are written by the component; a timeline on the same
 * screen reads them and asks for a seek through `seek`.
 */
export default function useMediaPlayer(object: ObjectInstance<MediaPlayerBlueprint>): MediaPlayer {
  const record = ref<Record<string, unknown> | undefined>();
  const currentTimeMs = ref(0);
  const mediaDurationMs = ref(0);
  const seekRequestMs = ref<number | null>(null);

  object.linkStore.subscribe<Record<string, unknown>[]>('DATA', 'dataAvailable', ({ payload }) => {
    // A single-record binding (a maintenance screen) carries its record here
    // before any cursorChange; the first row is the record until told otherwise.
    if (!record.value && Array.isArray(payload) && payload.length > 0) record.value = payload[0];
  });
  object.linkStore.subscribe<{ selectedRecord: Record<string, unknown> | undefined }>(
    'DATA',
    'cursorChange',
    ({ payload }) => {
      record.value = payload?.selectedRecord;
    }
  );

  return Object.assign(object, {
    record,
    currentTimeMs,
    mediaDurationMs,
    seekRequestMs,
    seek(ms: number) {
      seekRequestMs.value = Math.max(0, ms);
    }
  });
}
