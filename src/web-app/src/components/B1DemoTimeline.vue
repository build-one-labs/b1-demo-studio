<!--
  b1_demo_timeline — the scenes of a run on one time axis.

  Each bound record is a block sized by its duration, with its cue markers as
  ticks; a scene that was not recorded is greyed. When `playerObject` names a
  b1_media_player on the same screen, the playhead follows it and clicking a
  scene seeks the player to the scene's start.

  Project-owned object type of the Demo Factory Studio (issue #17); registered
  by plugins/object-types.client.ts under the alias `demoTimeline`.
-->
<template>
  <div :class="['b1-demo-timeline flex flex-col gap-2', instance.attributes.htmlClass]">
    <div class="flex items-center justify-between text-sm text-muted-color">
      <span>{{ scenes.length }} {{ scenes.length === 1 ? 'scene' : 'scenes' }}</span>
      <span>{{ format(totalMs) }}</span>
    </div>
    <div
      v-if="scenes.length === 0"
      class="rounded border border-dashed border-surface-300 p-6 text-center text-sm text-muted-color"
    >
      No scenes.
    </div>
    <div
      v-else
      class="relative flex h-16 w-full select-none gap-px overflow-hidden rounded bg-surface-100 dark:bg-surface-800"
    >
      <button
        v-for="scene in scenes"
        :key="scene.key"
        type="button"
        class="relative h-full min-w-0 overflow-hidden border-0 p-0 text-left"
        :class="
          scene.recorded
            ? 'bg-primary-100 hover:bg-primary-200 dark:bg-primary-900'
            : 'bg-surface-200 dark:bg-surface-700'
        "
        :style="{ flexGrow: scene.durationMs, flexBasis: 0 }"
        :title="`${scene.title} — ${format(scene.durationMs)}${scene.recorded ? '' : ' (not recorded)'}`"
        @click="seek(scene.startMs)"
      >
        <span class="absolute inset-x-1 top-1 truncate text-xs font-medium text-surface-900 dark:text-surface-0">
          {{ scene.index }}. {{ scene.title }}
        </span>
        <span class="absolute inset-x-1 bottom-1 truncate text-xs text-muted-color">{{
          format(scene.durationMs)
        }}</span>
        <span
          v-for="cue in scene.cues"
          :key="cue.name"
          class="absolute bottom-0 top-0 w-px bg-orange-500"
          :style="{ left: `${cue.percent}%` }"
          :title="`[cue:${cue.name}] at ${format(cue.offsetMs)}`"
        />
      </button>
      <span
        v-if="playheadPercent != null"
        class="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-red-500"
        :style="{ left: `${playheadPercent}%` }"
      />
    </div>
    <div v-if="allCues.length" class="flex flex-wrap gap-2 text-xs text-muted-color">
      <span
        v-for="cue in allCues"
        :key="cue"
        class="rounded bg-orange-50 px-1.5 py-0.5 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
      >
        [cue:{{ cue }}]
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import type { DemoTimeline } from '~/types/object/demoTimeline.types';
import type { MediaPlayer } from '~/types/object/mediaPlayer.types';

// The instance arrives as a reactive proxy, so the refs useDemoTimeline put on
// it are unwrapped here: `instance.records` is the array, not a ref — and the
// player's `currentTimeMs` read below is a number.
const props = defineProps<{ instance: DemoTimeline }>();

const records = computed(() => (props.instance.records as unknown as Record<string, unknown>[] | undefined) ?? []);

interface SceneBlock {
  key: string;
  index: number;
  title: string;
  startMs: number;
  durationMs: number;
  recorded: boolean;
  cues: { name: string; offsetMs: number; percent: number }[];
}

const scenes = computed<SceneBlock[]>(() => {
  const durationField = props.instance.attributes.durationField || 'durationMs';
  const cuesField = props.instance.attributes.cuesField || 'cues';
  let start = 0;
  return [...records.value]
    .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0))
    .map((record, index) => {
      const durationMs = Math.max(1000, Number(record[durationField]) || 0);
      const cues = Object.entries((record[cuesField] as Record<string, number> | undefined) ?? {}).map(
        ([name, offsetMs]) => ({ name, offsetMs, percent: Math.min(100, (offsetMs / durationMs) * 100) })
      );
      const block: SceneBlock = {
        key: String(record.id ?? index),
        index: index + 1,
        title: String(record.title ?? record.sceneId ?? ''),
        startMs: start,
        durationMs,
        recorded: record.hasClip !== false,
        cues
      };
      start += durationMs;
      return block;
    });
});

const totalMs = computed(() => scenes.value.reduce((sum, scene) => sum + scene.durationMs, 0));
const allCues = computed(() => [...new Set(scenes.value.flatMap((scene) => scene.cues.map((cue) => cue.name)))]);

/** The player this timeline follows, resolved on the screen by instance name. */
const player = computed<MediaPlayer | undefined>(() => {
  const name = props.instance.attributes.playerObject;
  if (!name) return undefined;
  const found = props.instance.screen?.getObject<MediaPlayer>(name) ?? undefined;
  return found && 'currentTimeMs' in found ? found : undefined;
});

const playheadPercent = computed(() => {
  if (!player.value || totalMs.value === 0) return null;
  const position = Number(player.value.currentTimeMs) || 0;
  if (!position && !Number(player.value.mediaDurationMs)) return null;
  return Math.min(100, (position / totalMs.value) * 100);
});

function seek(ms: number) {
  player.value?.seek(ms);
}

function format(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
</script>
