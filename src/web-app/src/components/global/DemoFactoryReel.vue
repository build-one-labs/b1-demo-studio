<!--
  The Demo Factory home screen: every demo as a strip of film, one frame per
  scene, cut from the demo's own footage (the newest rendered run, else the
  uploaded recording; see server-actions/demo-factory/demo-factory.reel.ts).

  A b1_native_component on purpose: a film strip with sprocket holes, edge
  codes and a projection overlay is a dashboard-style visual no b1 object type
  composes. b1_card_view renders a card per record, not a horizontal strip of
  images per record, so the overview would lose exactly what it is for. The
  data still comes from the Studio's data sources, through the `reel` action.
-->
<template>
  <section class="reel-room">
    <header class="reel-head">
      <div>
        <p class="reel-kicker">Demo Factory · Vorführraum</p>
        <h1 class="reel-title">Alle Demos</h1>
      </div>
      <dl class="reel-stats">
        <div>
          <dt>Demos</dt>
          <dd>{{ demos.length }}</dd>
        </div>
        <div>
          <dt>Gerendert</dt>
          <dd>{{ renderedCount }}</dd>
        </div>
        <div>
          <dt>Laufzeit</dt>
          <dd>{{ formatDuration(totalMs) }}</dd>
        </div>
      </dl>
      <button class="reel-refresh" type="button" :disabled="loading" title="Neu laden" @click="load">
        <Icon name="lucide-refresh-cw" :class="{ 'animate-spin': loading }" aria-hidden="true" />
      </button>
    </header>

    <p v-if="error" class="reel-message">{{ error }}</p>
    <p v-else-if="!loading && demos.length === 0" class="reel-message">
      Noch keine Demos. Lege unter „Demos“ eines an oder importiere ein Bildschirmvideo.
    </p>

    <article
      v-for="(demo, demoIndex) in demos"
      :key="demo.id"
      class="reel"
      :style="{ '--delay': `${demoIndex * 70}ms` }"
    >
      <div class="reel-meta">
        <button class="reel-name" type="button" @click="openDemo(demo.id)">{{ demo.title }}</button>
        <span class="reel-badge" :class="`reel-badge--${demo.footage}`">{{ FOOTAGE_LABEL[demo.footage] }}</span>
        <span v-if="demo.invalid" class="reel-badge reel-badge--invalid">Ungültig</span>
        <span class="reel-facts">
          {{ demo.sceneCount }} {{ demo.sceneCount === 1 ? 'Szene' : 'Szenen' }}
          <template v-if="demo.durationMs"> · {{ formatDuration(demo.durationMs) }}</template>
          <template v-if="demo.recordedAt"> · aufgenommen {{ formatDate(demo.recordedAt) }}</template>
        </span>
        <span class="reel-actions">
          <button v-if="demo.videoUrl" class="reel-play" type="button" @click="projected = demo">
            <Icon name="lucide-play" aria-hidden="true" /> Abspielen
          </button>
          <button class="reel-open" type="button" @click="openDemo(demo.id)">
            Öffnen <Icon name="lucide-arrow-right" aria-hidden="true" />
          </button>
        </span>
      </div>

      <div class="strip" role="list" :aria-label="`Szenen von ${demo.title}`">
        <figure
          v-for="(frame, index) in demo.frames"
          :key="frame.sceneId"
          class="frame"
          role="listitem"
          :title="frame.title"
          @click="demo.videoUrl ? (projected = demo) : openDemo(demo.id)"
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
            <span class="edge-code">{{ edgeCode(demoIndex, index) }}</span>
            <span class="frame-title">{{ frame.title }}</span>
          </figcaption>
        </figure>
        <div v-if="demo.frames.length === 0" class="frame frame--empty">
          <div class="frame-window"><div class="frame-blank">Keine Szenen</div></div>
        </div>
      </div>
    </article>

    <div
      v-if="projected"
      class="projector"
      role="dialog"
      aria-modal="true"
      @click.self="projected = null"
      @keydown.esc="projected = null"
    >
      <div class="projector-screen">
        <header>
          <span>{{ projected.title }}</span>
          <button type="button" title="Schließen" @click="projected = null">
            <Icon name="lucide-x" aria-hidden="true" />
          </button>
        </header>
        <video :src="projected.videoUrl" controls autoplay playsinline />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { displayError, invokeServerTask, launchScreen } from '@buildone/web-core';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

interface ReelFrame {
  sceneId: string;
  title: string;
  imageUrl: string;
}

interface ReelDemo {
  id: string;
  title: string;
  description: string;
  sceneCount: number;
  footage: 'run' | 'source' | 'none';
  frames: ReelFrame[];
  videoUrl: string;
  runId: string;
  durationMs: number | null;
  recordedAt: string | null;
  editedAt: string | null;
  invalid: boolean;
}

const FOOTAGE_LABEL: Record<ReelDemo['footage'], string> = {
  run: 'Gerendert',
  source: 'Quellvideo',
  none: 'Noch nicht gefilmt'
};

const demos = ref<ReelDemo[]>([]);
const loading = ref(false);
const error = ref('');
const projected = ref<ReelDemo | null>(null);
const broken = ref(new Set<string>());

const renderedCount = computed(() => demos.value.filter((demo) => demo.videoUrl).length);
const totalMs = computed(() =>
  demos.value.reduce((sum, demo) => sum + (demo.videoUrl ? (demo.durationMs ?? 0) : 0), 0)
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const result = (await invokeServerTask({
      name: 'demo-factory',
      methodName: 'demo-factory-studio/reel',
      methodType: 'serverAction',
      paramObj: {}
    })) as { demos?: ReelDemo[] };
    demos.value = result?.demos ?? [];
  } catch (cause) {
    error.value = `Die Demos konnten nicht geladen werden: ${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    loading.value = false;
  }
}

async function openDemo(id: string): Promise<void> {
  try {
    await launchScreen('DemoFactoryDemoMaintenance', { repositionTo: id });
  } catch (cause) {
    displayError(cause instanceof Error ? cause.message : String(cause));
  }
}

function markBroken(url: string): void {
  broken.value = new Set(broken.value).add(url);
}

/** Film-edge marking: reel number, then frame number with the A/B half-frame letter. */
function edgeCode(reel: number, frame: number): string {
  return `${String(reel + 1).padStart(2, '0')} ▸ ${String(frame + 1).padStart(2, '0')}${frame % 2 ? 'B' : 'A'}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') projected.value = null;
}

onMounted(() => {
  void load();
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
.reel-room {
  --film: #121214;
  --film-edge: #1c1c20;
  --sprocket: #f4efe6;
  --amber: #f5b33c;
  --ink: #f3f1ec;
  --muted: #a7a39a;
  min-height: 100%;
  padding: 28px 28px 40px;
  color: var(--ink);
  background: radial-gradient(1200px 500px at 15% -10%, rgb(245 179 60 / 12%), transparent 60%),
    radial-gradient(900px 400px at 100% 0%, rgb(18 102 241 / 14%), transparent 60%), #0a0b0f;
  border-radius: 12px;
}

.reel-head {
  display: flex;
  align-items: flex-end;
  gap: 32px;
  margin-bottom: 28px;
}

.reel-kicker {
  margin: 0 0 6px;
  font:
    600 11px/1 ui-monospace,
    'SFMono-Regular',
    Menlo,
    monospace;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--amber);
}

.reel-title {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.reel-stats {
  display: flex;
  gap: 28px;
  margin: 0 0 0 auto;
}

.reel-stats dt {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

.reel-stats dd {
  margin: 2px 0 0;
  font:
    700 22px/1.1 ui-monospace,
    Menlo,
    monospace;
  font-variant-numeric: tabular-nums;
}

.reel-refresh {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  color: var(--ink);
  background: rgb(255 255 255 / 6%);
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 999px;
  cursor: pointer;
}

.reel-message {
  color: var(--muted);
}

/* Each demo is a framed card, so one strip never runs into the next. */
.reel {
  margin-bottom: 22px;
  padding: 16px 16px 18px;
  background: linear-gradient(180deg, rgb(255 255 255 / 5%), rgb(255 255 255 / 2%));
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 12px;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 60%),
    0 14px 30px -18px rgb(0 0 0 / 90%);
  transition: border-color 200ms ease;
  animation: reel-in 500ms ease-out both;
  animation-delay: var(--delay);
}

.reel:hover {
  border-color: rgb(245 179 60 / 45%);
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
  color: var(--amber);
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
  color: #7ee2a8;
}

.reel-badge--source {
  color: #8fb8ff;
}

.reel-badge--none {
  color: var(--muted);
}

.reel-badge--invalid {
  color: #ff8a80;
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
  background: var(--amber);
  border: 0;
}

.reel-open {
  color: var(--ink);
  background: transparent;
  border: 1px solid rgb(255 255 255 / 18%);
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
  color: var(--muted);
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
  color: var(--amber);
  opacity: 0.85;
}

.frame-title {
  overflow: hidden;
  font-size: 12px;
  color: #d9d5cc;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.projector {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(4 4 6 / 88%);
  backdrop-filter: blur(4px);
}

.projector-screen {
  width: min(1200px, 100%);
  overflow: hidden;
  background: #000;
  border-radius: 10px;
  box-shadow: 0 0 120px rgb(245 179 60 / 18%);
}

.projector-screen header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  font-weight: 600;
  color: var(--ink);
  background: #101014;
}

.projector-screen header button {
  font-size: 18px;
  color: var(--ink);
  background: none;
  border: 0;
  cursor: pointer;
}

.projector-screen video {
  display: block;
  width: 100%;
  max-height: 78vh;
  background: #000;
}

@media (max-width: 720px) {
  .reel-room {
    padding: 18px 16px 28px;
  }

  .reel-head {
    flex-wrap: wrap;
    gap: 16px;
  }

  .reel-stats {
    margin-left: 0;
  }

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
