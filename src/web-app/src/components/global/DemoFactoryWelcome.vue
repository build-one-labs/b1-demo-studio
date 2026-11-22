<!--
  Welcome panel of the Demo Factory overview (DemoFactoryHomeScreen), above the
  card view of all demos: a greeting, what the Studio is for, the key figures,
  the newest recording as a spotlight, and the buttons that start a demo.

  A b1_native_component on purpose (CLAUDE.md, reason 1: no b1 object type fits):
  it is a dashboard header — KPI tiles that count up, a ring chart of rendered
  versus unfilmed demos, a spotlight frame and a time-of-day greeting in one
  composed layout. No object type composes that; the demo list itself stays the
  b1_card_view below it.

  Data: the overview's own data source endpoint (demo-factory/reel, unfiltered),
  re-read when the Studio reports a change (`demo-factory:demos-changed`, sent by
  refreshDemos in the client logic) and when the tab becomes visible again.
-->
<template>
  <section class="welcome" :class="{ 'welcome--ready': ready }">
    <div class="welcome-aurora" aria-hidden="true" />

    <div class="welcome-intro">
      <p class="welcome-kicker">
        <Icon name="lucide-clapperboard" aria-hidden="true" />
        Demo Factory Studio
      </p>
      <h1 class="welcome-title">
        {{ greeting }}<template v-if="firstName">, {{ firstName }}</template>
      </h1>
      <p class="welcome-lead">
        Hier entstehen Produktvideos aus einem Bauplan: Szenen beschreiben, die Factory nimmt sie in der echten App auf,
        spricht den Text ein und schneidet das Video. Unten siehst du jede Demo als Filmstreifen.
      </p>
      <!-- Same labels, tooltips and order as the toolbar of the Demos screen (DemoFactoryDemoSearchToolbar). -->
      <div class="welcome-actions">
        <button
          type="button"
          class="welcome-button welcome-button--primary"
          title="Create a demo — as a copy of the selected one, or from the blank starter"
          @click="open('DemoFactoryDemoCreate')"
        >
          <Icon name="lucide-plus" aria-hidden="true" /> New demo
        </button>
        <button
          type="button"
          class="welcome-button"
          title="Import a demo.yaml"
          @click="open('DemoFactoryImportScreen')"
        >
          <Icon name="lucide-upload" aria-hidden="true" /> Import
        </button>
        <button
          type="button"
          class="welcome-button"
          title="Turn your own screen recording of a B1 app into a demo — cut into scenes, narration from your voice"
          @click="open('DemoFactoryVideoImportScreen')"
        >
          <Icon name="lucide-file-video" aria-hidden="true" /> Import video
        </button>
      </div>
    </div>

    <div class="welcome-figures">
      <div class="welcome-ring" :title="`${rendered} von ${total} Demos gerendert`">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="ring-track" cx="60" cy="60" r="50" />
          <circle class="ring-value" cx="60" cy="60" r="50" :stroke-dasharray="RING" :stroke-dashoffset="ringOffset" />
        </svg>
        <div class="ring-label">
          <strong>{{ Math.round(animated.share) }}%</strong>
          <span>gerendert</span>
        </div>
      </div>

      <dl class="welcome-kpis">
        <div class="kpi">
          <dt><Icon name="lucide-film" aria-hidden="true" /> Demos</dt>
          <dd>{{ Math.round(animated.total) }}</dd>
          <small>{{ Math.round(animated.mine) }} von dir</small>
        </div>
        <div class="kpi">
          <dt><Icon name="lucide-circle-play" aria-hidden="true" /> Gerendert</dt>
          <dd>{{ Math.round(animated.rendered) }}</dd>
          <small>{{ unfilmed }} noch nicht gefilmt</small>
        </div>
        <div class="kpi">
          <dt><Icon name="lucide-list-video" aria-hidden="true" /> Szenen</dt>
          <dd>{{ Math.round(animated.scenes) }}</dd>
          <small>in allen Demos</small>
        </div>
        <div class="kpi">
          <dt><Icon name="lucide-timer" aria-hidden="true" /> Laufzeit</dt>
          <dd>{{ formatDuration(animated.runtimeMs) }}</dd>
          <small>fertiges Video</small>
        </div>
      </dl>

      <button
        v-if="latest"
        type="button"
        class="welcome-spotlight"
        :title="`${latest.title} abspielen`"
        @click="play(latest)"
      >
        <span class="spotlight-frame">
          <img v-if="latest.frames[0]?.imageUrl" :src="latest.frames[0].imageUrl" alt="" loading="lazy" />
          <span class="spotlight-play"><Icon name="lucide-play" aria-hidden="true" /></span>
        </span>
        <span class="spotlight-text">
          <small>Zuletzt aufgenommen{{ latest.recordedAt ? ` · ${formatDate(latest.recordedAt)}` : '' }}</small>
          <strong>{{ latest.title }}</strong>
        </span>
      </button>
    </div>

    <p v-if="error" class="welcome-error">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { displayError, launchScreen, useUserStore } from '@buildone/web-core';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

interface ReelDemo {
  id: string;
  title: string;
  sceneCount: number;
  footage: 'run' | 'source' | 'none';
  frames: { imageUrl: string }[];
  videoUrl: string;
  runId: string;
  durationMs: number | null;
  recordedAt: string | null;
  owner: string;
}

/** Circumference of the ring (r = 50). */
const RING = 2 * Math.PI * 50;
const CHANGED = 'demo-factory:demos-changed';

const demos = ref<ReelDemo[]>([]);
const ready = ref(false);
const error = ref('');
const now = ref(new Date());

const user = computed(() => useUserStore().user);
const firstName = computed(() => (user.value?.userName ?? '').trim().split(/\s+/)[0] ?? '');
const greeting = computed(() => {
  const hour = now.value.getHours();
  if (hour < 5) return 'Gute Nacht';
  if (hour < 11) return 'Guten Morgen';
  if (hour < 18) return 'Guten Tag';
  return 'Guten Abend';
});

const total = computed(() => demos.value.length);
const rendered = computed(() => demos.value.filter((demo) => demo.videoUrl).length);
const unfilmed = computed(() => demos.value.filter((demo) => demo.footage === 'none').length);
const figures = computed(() => ({
  total: total.value,
  mine: demos.value.filter((demo) => demo.owner && demo.owner === user.value?.email).length,
  rendered: rendered.value,
  scenes: demos.value.reduce((sum, demo) => sum + (demo.sceneCount ?? 0), 0),
  runtimeMs: demos.value.reduce((sum, demo) => sum + (demo.videoUrl ? (demo.durationMs ?? 0) : 0), 0),
  share: total.value ? (rendered.value / total.value) * 100 : 0
}));
const latest = computed(
  () =>
    demos.value
      .filter((demo) => demo.videoUrl)
      .sort((left, right) => String(right.recordedAt ?? '').localeCompare(String(left.recordedAt ?? '')))[0]
);

/** The figures as shown: they count up to the real ones (eased), once per change. */
const animated = reactive({ total: 0, mine: 0, rendered: 0, scenes: 0, runtimeMs: 0, share: 0 });
const ringOffset = computed(() => RING * (1 - Math.min(100, animated.share) / 100));
let frame = 0;

function countUp(target: typeof animated): void {
  cancelAnimationFrame(frame);
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    Object.assign(animated, target);
    return;
  }
  const start = { ...animated };
  const began = performance.now();
  const step = (time: number) => {
    const progress = Math.min(1, (time - began) / 900);
    const eased = 1 - (1 - progress) ** 3;
    for (const key of Object.keys(target) as (keyof typeof animated)[]) {
      animated[key] = start[key] + (target[key] - start[key]) * eased;
    }
    if (progress < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

watch(figures, (target) => countUp(target));

async function load(): Promise<void> {
  try {
    const response = await fetch('/service/app/demo-factory/reel');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    demos.value = (await response.json()) as ReelDemo[];
    error.value = '';
  } catch (cause) {
    error.value = `Die Kennzahlen konnten nicht geladen werden: ${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    ready.value = true;
  }
}

async function open(screen: string): Promise<void> {
  try {
    await launchScreen(screen);
  } catch (cause) {
    displayError(cause instanceof Error ? cause.message : String(cause));
  }
}

async function play(demo: ReelDemo): Promise<void> {
  try {
    await launchScreen('DemoFactoryReelPlayer', { repositionTo: demo.runId });
  } catch (cause) {
    displayError(cause instanceof Error ? cause.message : String(cause));
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

const onChanged = () => void load();
const onVisible = () => {
  if (document.visibilityState === 'visible') {
    now.value = new Date();
    void load();
  }
};

onMounted(() => {
  void load();
  window.addEventListener(CHANGED, onChanged);
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  window.removeEventListener(CHANGED, onChanged);
  document.removeEventListener('visibilitychange', onVisible);
});
</script>

<style scoped>
/* Colours follow the app theme (`.app-dark` on <html>, PrimeVue's dark-mode selector). */
.welcome {
  --ink: var(--p-text-color, #1e293b);
  --muted: var(--p-text-muted-color, #64748b);
  --accent: #b86e00;
  --accent-strong: #f5b33c;
  --glass: rgb(255 255 255 / 70%);
  --glass-border: rgb(15 23 42 / 8%);
  --surface: var(--p-content-background, #fff);
  --track: rgb(15 23 42 / 8%);

  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 28px;
  padding: 28px 32px;
  overflow: hidden;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  isolation: isolate;
}

.app-dark .welcome {
  --ink: #f3f1ec;
  --muted: #a7a39a;
  --accent: #f5b33c;
  --glass: rgb(255 255 255 / 5%);
  --glass-border: rgb(255 255 255 / 10%);
  --surface: #14110d;
  --track: rgb(255 255 255 / 10%);
}

/* Slowly drifting light behind everything — the projector's glow. */
.welcome-aurora {
  position: absolute;
  inset: -40%;
  z-index: -1;
  background: radial-gradient(30% 35% at 20% 30%, rgb(245 179 60 / 22%), transparent 70%),
    radial-gradient(28% 32% at 75% 25%, rgb(232 150 26 / 14%), transparent 70%),
    radial-gradient(30% 30% at 60% 85%, rgb(225 29 72 / 8%), transparent 70%);
  filter: blur(10px);
  animation: aurora 22s ease-in-out infinite alternate;
}

@keyframes aurora {
  to {
    transform: translate3d(6%, -4%, 0) rotate(8deg) scale(1.08);
  }
}

.welcome-intro,
.welcome-figures {
  opacity: 0;
  transform: translateY(10px);
  transition:
    opacity 500ms ease,
    transform 500ms ease;
}

.welcome-figures {
  transition-delay: 120ms;
}

.welcome--ready .welcome-intro,
.welcome--ready .welcome-figures {
  opacity: 1;
  transform: none;
}

.welcome-kicker {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 10px;
  font:
    600 11px/1 ui-monospace,
    Menlo,
    monospace;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
}

.welcome-title {
  margin: 0;
  font-size: clamp(26px, 3vw, 36px);
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.02em;
  background: linear-gradient(90deg, var(--ink) 40%, var(--accent));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.welcome-lead {
  max-width: 56ch;
  margin: 12px 0 22px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--muted);
}

.welcome-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.welcome-button {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  background: var(--glass);
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.welcome-button:hover {
  transform: translateY(-1px);
  border-color: var(--accent);
}

.welcome-button--primary {
  color: #1a1305;
  background: linear-gradient(135deg, #ffd27a, #f5b33c 55%, #e8922a);
  border-color: transparent;
  box-shadow: 0 10px 24px -12px rgb(245 179 60 / 90%);
}

.welcome-button--primary:hover {
  border-color: transparent;
  box-shadow: 0 14px 30px -12px rgb(245 179 60 / 100%);
}

.welcome-figures {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 18px 22px;
  align-items: center;
}

.welcome-ring {
  position: relative;
  width: 132px;
  height: 132px;
}

.welcome-ring svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.ring-track,
.ring-value {
  fill: none;
  stroke-width: 10;
}

.ring-track {
  stroke: var(--track);
}

.ring-value {
  stroke: var(--accent-strong);
  stroke-linecap: round;
  filter: drop-shadow(0 0 6px rgb(245 179 60 / 55%));
}

.ring-label {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
}

.ring-label strong {
  font:
    700 24px/1 ui-monospace,
    Menlo,
    monospace;
  font-variant-numeric: tabular-nums;
}

.ring-label span {
  margin-top: 4px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.welcome-kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.kpi {
  padding: 10px 14px;
  background: var(--glass);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  backdrop-filter: blur(8px);
}

.kpi dt {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}

.kpi dd {
  margin: 4px 0 2px;
  font:
    700 24px/1.1 ui-monospace,
    Menlo,
    monospace;
  font-variant-numeric: tabular-nums;
}

.kpi small {
  font-size: 12px;
  color: var(--muted);
}

.welcome-spotlight {
  display: flex;
  grid-column: 1 / -1;
  gap: 14px;
  align-items: center;
  padding: 8px;
  text-align: left;
  color: var(--ink);
  background: var(--glass);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: border-color 160ms ease;
}

.welcome-spotlight:hover {
  border-color: var(--accent);
}

.spotlight-frame {
  position: relative;
  flex: 0 0 auto;
  width: 120px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #050506;
  border-radius: 6px;
}

.spotlight-frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: sepia(0.3) brightness(0.85);
  transition:
    filter 260ms ease,
    transform 380ms ease;
}

.welcome-spotlight:hover .spotlight-frame img {
  filter: none;
  transform: scale(1.06);
}

.spotlight-play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 22px;
  color: #fff;
  text-shadow: 0 2px 8px rgb(0 0 0 / 60%);
}

.spotlight-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.spotlight-text small {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.spotlight-text strong {
  overflow: hidden;
  font-size: 14px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.welcome-error {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 13px;
  color: #b91c1c;
}

@media (max-width: 1100px) {
  .welcome {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .welcome {
    padding: 20px 16px;
  }

  .welcome-figures {
    grid-template-columns: minmax(0, 1fr);
  }

  .welcome-ring {
    justify-self: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-aurora {
    animation: none;
  }

  .welcome-intro,
  .welcome-figures {
    transition: none;
  }
}
</style>
