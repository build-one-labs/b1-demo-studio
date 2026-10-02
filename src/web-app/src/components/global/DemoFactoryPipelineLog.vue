<template>
  <B1LogView :instance="logInstance" />
</template>

<script setup lang="ts">
import { computed } from 'vue';

import type { NativeComponent } from '@buildone/web-core';
import type { LogView } from '~/types/object/logView.types';

import B1LogView from '~/components/B1LogView.vue';

const props = defineProps<{ instance: NativeComponent }>();

// Use the framework's built-in native component loader. These defaults belong
// to the Demo Factory adapter; the reusable log view remains configurable.
const logInstance = computed(
  () =>
    ({
      ...props.instance,
      screen: props.instance.screen,
      attributes: {
        ...props.instance.attributes,
        logSource: 'demo-factory/demo-factory-studio/job-status',
        pollIntervalMs: 1500,
        maxLines: 500,
        autoScroll: true
      }
    }) as unknown as LogView
);
</script>
