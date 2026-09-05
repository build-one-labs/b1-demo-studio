<!--
  b1_media_player — plays the video of the record it is bound to.

  The record arrives through the DATA link (see useMediaPlayer); `srcField`
  and `captionsField` name the fields holding the URLs. Position and length
  are written back onto the instance so a b1_demo_timeline on the same screen
  can show the playhead, and a seek the timeline asks for is carried out here.

  Project-owned object type of the Demo Factory Studio (issue #17); registered
  by plugins/object-types.client.ts under the alias `mediaPlayer`.
-->
<template>
  <div :class="['b1-media-player flex flex-col gap-2', instance.attributes.htmlClass]">
    <video
      v-if="src"
      ref="videoRef"
      :key="src"
      :src="src"
      controls
      preload="metadata"
      class="w-full rounded bg-black"
      @timeupdate="onTime"
      @loadedmetadata="onLoaded"
      @seeked="onTime"
    />
    <div
      v-else
      class="flex items-center justify-center rounded border border-dashed border-surface-300 p-8 text-sm text-muted-color dark:border-surface-600"
    >
      {{ record ? 'This run has no rendered video.' : 'No run selected.' }}
    </div>
    <div v-if="src" class="flex flex-wrap items-center gap-3 text-sm text-muted-color">
      <span>{{ format(currentTimeMs.value) }} / {{ format(mediaDurationMs.value) }}</span>
      <a :href="downloadUrl(src)" class="text-primary" download>Download video</a>
      <a v-if="captions" :href="downloadUrl(captions)" class="text-primary" download>Download captions</a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef, useTemplateRef, watch } from 'vue';

import type { MediaPlayer } from '~/types/object/mediaPlayer.types';

// The instance arrives as a reactive proxy, so the refs useMediaPlayer put on
// it are unwrapped here: `instance.record` is the record, not a ref. Writing
// goes through toRef, which reaches the same state a timeline reads.
const props = defineProps<{ instance: MediaPlayer }>();
const videoRef = useTemplateRef<HTMLVideoElement>('videoRef');

const currentTimeMs = toRef(props.instance, 'currentTimeMs') as unknown as { value: number };
const mediaDurationMs = toRef(props.instance, 'mediaDurationMs') as unknown as { value: number };
const seekRequestMs = toRef(props.instance, 'seekRequestMs') as unknown as { value: number | null };
const record = computed(() => props.instance.record as unknown as Record<string, unknown> | undefined);

const field = (name: string): string => {
  const value = record.value?.[name];
  return typeof value === 'string' ? value : '';
};
const src = computed(() => field(props.instance.attributes.srcField || 'videoUrl'));
const captions = computed(() => field(props.instance.attributes.captionsField || 'srtUrl'));

/** The media route's attachment twin: …/<file> → …/download/<file>. */
const downloadUrl = (url: string) => url.replace(/\/([^/]+)$/, '/download/$1');

function onTime() {
  if (videoRef.value) currentTimeMs.value = Math.round(videoRef.value.currentTime * 1000);
}
function onLoaded() {
  if (videoRef.value) mediaDurationMs.value = Math.round(videoRef.value.duration * 1000);
}

// A seek asked for by the timeline: carried out, then consumed.
watch(
  () => seekRequestMs.value,
  (ms) => {
    if (ms == null || !videoRef.value) return;
    videoRef.value.currentTime = ms / 1000;
    seekRequestMs.value = null;
  }
);

function format(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
</script>
