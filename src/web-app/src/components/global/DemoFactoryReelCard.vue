<!--
  Card template of DemoFactoryReelCardView (b1_card_view) on the Demo Factory
  overview: one demo as a strip of film, one frame per scene, cut from the
  demo's own footage (the newest rendered run, else the uploaded recording).
  The record comes from DemoFactoryReelDSO (b1_data_source_server, backed by
  server-actions/demo-factory/demo-factory.reel.controller.ts).
-->
<template>
  <article class="reel" :class="{ 'reel--selected': props.selected }" @click="emit('click', props.item)">
    <div class="reel-meta">
      <button class="reel-name" type="button" @click.stop="openDemo">{{ demo.title }}</button>
      <span class="reel-badge" :class="`reel-badge--${demo.footage}`">{{ FOOTAGE_LABEL[demo.footage] }}</span>
      <span v-if="demo.invalid" class="reel-badge reel-badge--invalid">Ungültig</span>
      <span class="reel-facts">
        {{ demo.sceneCount }} {{ demo.sceneCount === 1 ? 'Szene' : 'Szenen' }}
        <template v-if="demo.durationMs"> · {{ formatDuration(demo.durationMs) }}</template>
        <template v-if="demo.recordedAt"> · aufgenommen {{ formatDate(demo.recordedAt) }}</template>
        <template v-if="demo.owner"> · {{ demo.owner }}</template>
      </span>
      <span class="reel-actions">
        <button v-if="demo.videoUrl" class="reel-play" type="button" @click.stop="play">
          <Icon name="lucide-play" aria-hidden="true" /> Abspielen
        </button>
        <button class="reel-open" type="button" @click.stop="openDemo">
          Öffnen <Icon name="lucide-arrow-right" aria-hidden="true" />
        </button>
      </span>
    </div>

    <div class="strip" role="list" :aria-label="`Szenen von ${demo.title}`">
      <figure
        v-for="(frame, index) in frames"
        :key="frame.sceneId"
        class="frame"
        role="listitem"
        :title="frame.title"
        @click.stop="demo.videoUrl ? play() : openDemo()"
      >
        <div class="frame-window">
          <img
            v-if="frame.imageUrl && !broken.has(frame.imageUrl)"
            :src="frame.imageUrl"
            :alt="frame.title"
            loading="lazy"
            @error="markBroken(frame.imageUrl)"
          />
          <div v-else class="frame-blank">
            <Icon name="lucide-clapperboard" class="frame-blank-icon" aria-hidden="true" />
            <span>{{ demo.footage === 'none' ? 'noch nicht gefilmt' : 'kein Bild' }}</span>
          </div>
        </div>
        <figcaption>
          <span class="edge-code">{{ edgeCode(index) }}</span>
          <span class="frame-title">{{ frame.title }}</span>
        </figcaption>
      </figure>
      <div v-if="frames.length === 0" class="frame frame--empty">
        <div class="frame-window"><div class="frame-blank">Keine Szenen</div></div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { displayError, launchScreen } from '@buildone/web-core';
import { computed, ref } from 'vue';

interface ReelFrame {
  sceneId: string;
  title: string;
  imageUrl: string;
}

/** A record of DemoFactoryReelDSO — see server-actions/demo-factory/demo-factory.reel.ts. */
interface ReelDemo {
  id: string;
  title: string;
  sceneCount: number;
  footage: 'run' | 'source' | 'none';
  frames: ReelFrame[] | string;
  videoUrl: string;
  runId: string;
  durationMs: number | null;
  recordedAt: string | null;
  invalid: boolean;
  owner: string;
}

const props = defineProps<{
  item: Record<string, unknown>;
  selected?: boolean;
}>();
const emit = defineEmits<{
  click: [item: Record<string, unknown>];
}>();

const FOOTAGE_LABEL: Record<ReelDemo['footage'], string> = {
  run: 'Gerendert',
  source: 'Quellvideo',
  none: 'Noch nicht gefilmt'
};

const demo = computed(() => props.item as unknown as ReelDemo);
/** The frames arrive as an array; a JSON string is tolerated in case a data layer flattens them. */
const frames = computed<ReelFrame[]>(() => {
  const value = demo.value.frames;
  if (Array.isArray(value)) return value;
  try {
    return typeof value === 'string' ? (JSON.parse(value) as ReelFrame[]) : [];
  } catch {
    return [];
  }
});

const broken = ref(new Set<string>());

/** The rendered video, in the modal player screen positioned on its run. */
async function play(): Promise<void> {
  try {
    await launchScreen('DemoFactoryReelPlayer', { repositionTo: demo.value.runId });
  } catch (cause) {
    displayError(cause instanceof Error ? cause.message : String(cause));
  }
}

async function openDemo(): Promise<void> {
  try {
    await launchScreen('DemoFactoryDemoMaintenance', { repositionTo: demo.value.id });
  } catch (cause) {
    displayError(cause instanceof Error ? cause.message : String(cause));
  }
}

function markBroken(url: string): void {
  broken.value = new Set(broken.value).add(url);
}

/** Film-edge marking: frame number with the A/B half-frame letter. */
function edgeCode(frame: number): string {
  return `▸ ${String(frame + 1).padStart(2, '0')}${frame % 2 ? 'B' : 'A'}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}
</script>

<style scoped>
/*
 * Colours follow the app theme (PrimeVue's dark-mode selector is `.app-dark` on <html>):
 * the card and its text use PrimeVue's tokens. The film strip itself
 * stays dark in both themes, as film does, so it keeps fixed
 * colours (--film*, --edge, --on-film).
 */

.app-dark .reel {
  --ink: #f3f1ec;
  --muted: #a7a39a;
  --accent: #f5b33c;
  --accent-soft: rgb(245 179 60 / 45%);
  --card: rgb(255 255 255 / 4%);
  --card-border: rgb(255 255 255 / 14%);
  --button-border: rgb(255 255 255 / 18%);
  --ok: #7ee2a8;
  --info: #8fb8ff;
  --bad: #ff8a80;
  --room: #0a0b0f;
}

/* Each demo is a framed card, so one strip never runs into the next. */
.reel {
  --film: #121214;
  --film-edge: #1c1c20;
  --sprocket: #f4efe6;
  --edge: #f5b33c;
  --on-film: #e4e0d7;
  --ink: var(--p-text-color, #334155);
  --muted: var(--p-text-muted-color, #64748b);
  --accent: #b86e00;
  --accent-soft: rgb(184 110 0 / 45%);
  --card: var(--p-surface-50, #f8fafc);
  --card-border: var(--p-content-border-color, #e2e8f0);
  --button-border: var(--p-content-border-color, #e2e8f0);
  --ok: #15803d;
  --info: #1d4ed8;
  --bad: #b91c1c;
  --room: var(--p-content-background, #fff);

  color: var(--ink);
  padding: 16px 16px 18px;
  background: var(--card);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  box-shadow: 0 14px 30px -20px rgb(0 0 0 / 45%);
  transition: border-color 200ms ease;
  animation: reel-in 500ms ease-out both;
}

.reel:hover,
.reel--selected {
  border-color: var(--accent-soft);
}

@keyframes reel-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}

.reel-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px 14px;
  margin: 0 2px 12px;
}

.reel-name {
  padding: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--ink);
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}

.reel-name:hover {
  color: var(--accent);
}

.reel-badge {
  padding: 3px 8px;
  font:
    600 10px/1 ui-monospace,
    Menlo,
    monospace;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: 4px;
  border: 1px solid currentcolor;
}

.reel-badge--run {
  color: var(--ok);
}

.reel-badge--source {
  color: var(--info);
}

.reel-badge--none {
  color: var(--muted);
}

.reel-badge--invalid {
  color: var(--bad);
}

.reel-facts {
  font-size: 13px;
  color: var(--muted);
}

.reel-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.reel-play,
.reel-open {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 999px;
  cursor: pointer;
}

.reel-play {
  color: #1a1305;
  background: #f5b33c;
  border: 0;
}

.reel-open {
  color: var(--ink);
  background: transparent;
  border: 1px solid var(--button-border);
}

/* The strip: film base with a row of sprocket holes along both edges. */
.strip {
  position: relative;
  display: flex;
  gap: 14px;
  padding: 26px 18px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  background:
    repeating-linear-gradient(90deg, transparent 0 7px, var(--sprocket) 7px 19px, transparent 19px 26px) top 8px left 0 /
      100% 10px no-repeat,
    repeating-linear-gradient(90deg, transparent 0 7px, var(--sprocket) 7px 19px, transparent 19px 26px) bottom 8px left
      0 / 100% 10px no-repeat,
    linear-gradient(180deg, var(--film-edge), var(--film) 18%, var(--film) 82%, var(--film-edge));
  border-radius: 6px;
  box-shadow:
    0 18px 40px -18px rgb(0 0 0 / 80%),
    inset 0 0 0 1px rgb(255 255 255 / 4%);
  scrollbar-width: thin;
  scrollbar-color: #3a3a40 transparent;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 18px, #000 calc(100% - 18px), transparent);
  mask-image: linear-gradient(90deg, transparent, #000 18px, #000 calc(100% - 18px), transparent);
}

.frame {
  flex: 0 0 auto;
  width: 232px;
  margin: 0;
  scroll-snap-align: start;
  cursor: pointer;
}

.frame-window {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #050506;
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 6%);
}

.frame-window img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: sepia(0.35) saturate(0.85) brightness(0.88) contrast(1.05);
  transform: scale(1.01);
  transition:
    filter 260ms ease,
    transform 380ms ease;
}

/* A faint gate weave: light falloff toward the corners like a projected frame. */
.frame-window::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse 120% 120% at center, transparent 72%, rgb(0 0 0 / 30%));
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 35%);
}

.frame:hover .frame-window img {
  filter: none;
  transform: scale(1.06);
}

.frame-blank {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  height: 100%;
  font:
    600 10px/1 ui-monospace,
    Menlo,
    monospace;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #5a5860;
  background: repeating-linear-gradient(135deg, #0d0d10 0 10px, #111115 10px 20px);
}

.frame-blank-icon {
  font-size: 26px;
}

.frame--empty .frame-blank {
  font-size: 12px;
  color: #8a877f;
}

.frame figcaption {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 2px 0;
}

.edge-code {
  font:
    600 10px/1 ui-monospace,
    Menlo,
    monospace;
  letter-spacing: 0.14em;
  color: var(--edge);
  opacity: 0.85;
}

.frame-title {
  overflow: hidden;
  font-size: 12px;
  color: var(--on-film);
  white-space: nowrap;
  text-overflow: ellipsis;
}

@media (max-width: 720px) {
  .frame {
    width: 180px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reel {
    animation: none;
  }

  .frame-window img {
    transition: none;
  }
}
</style>
