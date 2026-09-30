<!--
  b1_log_view — the live log of a running server-side process.

  The view asks the action named in `logSource` how the process is doing:
  every `pollIntervalMs` while it runs, four times less often while it is
  idle, so an open screen stays cheap. It renders the status line, then the
  tail — stderr in red — capped at `maxLines`, pinned to the newest line while
  auto-scroll is on. Nothing here knows about demos: the shape it reads is
  { status, step, exitCode, logs: [{ stream, text }] }, which is what the demo
  factory's job-status answers and what any other pipeline could answer too.

  Project-owned object type of the Demo Factory Studio (issue #17); registered
  by plugins/object-types.client.ts under the alias `logView`.
-->
<template>
  <div :class="['b1-log-view flex h-full min-h-0 flex-col gap-2', instance.attributes.htmlClass]">
    <div class="flex flex-wrap items-center gap-3 text-sm">
      <span class="inline-flex items-center gap-2">
        <i :class="['pi', statusIcon, { 'pi-spin': running }]" />
        <strong>{{ statusLabel }}</strong>
      </span>
      <span v-if="snapshot?.step" class="text-muted-color">step {{ snapshot.step }}</span>
      <span v-if="snapshot?.exitCode != null" class="text-muted-color">exit {{ snapshot.exitCode }}</span>
      <span v-if="error" class="text-red-500">{{ error }}</span>
      <span class="ml-auto inline-flex items-center gap-2 text-muted-color">
        <label class="inline-flex cursor-pointer items-center gap-1">
          <Checkbox v-model="autoScroll" binary size="small" />
          <span>Follow</span>
        </label>
        <Button label="Refresh" icon="pi pi-refresh" text size="small" @click="poll" />
      </span>
    </div>
    <pre
      ref="tailRef"
      class="b1-log-view-tail m-0 min-h-0 flex-1 overflow-auto rounded border border-surface-200 bg-surface-950 p-3 font-mono text-xs leading-relaxed text-surface-100 dark:border-surface-700"
    ><template v-if="lines.length === 0">Ready.</template><template v-for="(line, index) in lines" :key="index"><span :class="line.stream === 'stderr' ? 'text-red-300' : ''">{{ line.text }}</span>
</template></pre>
  </div>
</template>

<script setup lang="ts">
import { invokeServerTask } from '@buildone/web-core';
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';

import type { LogSnapshot, LogView } from '~/types/object/logView.types';

const props = defineProps<{ instance: LogView }>();

const snapshot = ref<LogSnapshot | null>(null);
const error = ref('');
const autoScroll = ref(props.instance.attributes.autoScroll !== false);
const tailRef = useTemplateRef<HTMLPreElement>('tailRef');

const running = computed(() => snapshot.value?.status === 'running');
const interval = computed(() => Math.max(500, Number(props.instance.attributes.pollIntervalMs) || 1500));
const maxLines = computed(() => Number(props.instance.attributes.maxLines) || 0);

const lines = computed(() => {
  const all = snapshot.value?.logs ?? [];
  return maxLines.value > 0 && all.length > maxLines.value ? all.slice(-maxLines.value) : all;
});

const statusLabel = computed(() => {
  switch (snapshot.value?.status) {
    case undefined:
      return 'Connecting…';
    case 'idle':
      return 'No active job';
    case 'running':
      return 'Running';
    case 'complete':
      return 'Complete';
    case 'failed':
      return 'Failed';
    default:
      return snapshot.value.status;
  }
});

const statusIcon = computed(() => {
  switch (snapshot.value?.status) {
    case 'running':
      return 'pi-spinner';
    case 'complete':
      return 'pi-check-circle text-green-500';
    case 'failed':
      return 'pi-times-circle text-red-500';
    default:
      return 'pi-circle';
  }
});

/** `logSource` is service/class/method; invokeServerTask wants the service apart from the rest. */
function source(): { name: string; methodName: string } | null {
  const parts = String(props.instance.attributes.logSource ?? '')
    .split('/')
    .filter(Boolean);
  if (parts.length < 2) return null;
  return { name: parts[0]!, methodName: parts.slice(1).join('/') };
}

async function poll(): Promise<void> {
  const action = source();
  if (!action) {
    error.value = 'No log source configured (logSource = service/class/method).';
    return;
  }
  try {
    snapshot.value = (await invokeServerTask({ ...action, methodType: 'serverAction', paramObj: {} })) as LogSnapshot;
    error.value = '';
  } catch (pollError) {
    error.value = pollError instanceof Error ? pollError.message : String(pollError);
  }
}

// One timer, re-armed after every answer: fast while the process runs, slow
// while nothing happens, never two requests in flight.
let timer: ReturnType<typeof setTimeout> | undefined;
async function tick(): Promise<void> {
  await poll();
  timer = setTimeout(tick, running.value ? interval.value : interval.value * 4);
}

onMounted(tick);
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});

// Keep the newest line in view while a job streams into the tail.
watch(lines, () => {
  if (!autoScroll.value) return;
  requestAnimationFrame(() => {
    if (tailRef.value) tailRef.value.scrollTop = tailRef.value.scrollHeight;
  });
});
</script>

<style scoped>
.b1-log-view-tail {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 60vh;
}
</style>
