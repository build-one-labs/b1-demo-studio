<!--
  b1_json_field — a form field for a structured record value (object or array).

  The record keeps the parsed value; the editor shows it pretty-printed. While
  the typed text is not valid JSON the field turns invalid, names the error and
  where it is, and stops emitting — malformed text never reaches the record,
  which is what lets the server-side schema validation stay the only judge of a
  demo document. This is the Studio's replacement for the parse-on-type
  textareas of the former DemoFactoryStudio component (issue #17).

  Same contract as the framework's B1Textarea: `instance` prop, v-model on the
  field value, focus / blur / value-change events, `nativeInstance` exposed for
  the form. Registered by plugins/field-types.client.ts under the type's
  uiComponentAlias `jsonField`.
-->
<template>
  <div :class="['flex flex-col', instance.attributes.htmlClass]">
    <div class="b1-field-label block">
      <label class="font-bold" :for="fieldId">
        {{ instance.attributes.label }}
        <span v-if="instance.attributes.required" class="text-red-500">*</span>
      </label>
    </div>
    <Textarea
      :id="fieldId"
      ref="textareaRef"
      :model-value="text"
      :rows="rows"
      :disabled="disabled"
      :invalid="Boolean(error)"
      class="font-mono text-sm"
      spellcheck="false"
      fluid
      @update:model-value="onInput"
      @focus="$emit('focus')"
      @blur="$emit('blur', $event)"
      @value-change="$emit('value-change')"
    />
    <small v-if="error" class="mt-1 text-red-500" role="alert">{{ error }}</small>
    <small v-else class="mt-1 text-muted-color">{{ summary }}</small>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue';

import type { B1ComponentExposed, FormElement } from '@buildone/web-core';
import type { ComponentPublicInstance } from 'vue';

const props = defineProps<{ instance: FormElement }>();
defineEmits<{ (e: 'focus' | 'value-change'): void; (e: 'blur', event: Event): void }>();

const model = defineModel<unknown>();
const textareaRef = useTemplateRef<ComponentPublicInstance>('textareaRef');

const fieldId = computed(() => props.instance.blueprint.name);
const rows = computed(() => Number(props.instance.attributes.rows) || 12);
const disabled = computed(() => props.instance.attributes.enabled === false);

/** What the editor shows; only valid text is ever pushed back into the model. */
const text = ref('');
const error = ref('');

const format = (value: unknown): string =>
  value == null || value === '' ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);

/**
 * Parse the editor text. Empty text is a legitimate "no value" (null), so a
 * cleared field saves as null rather than as an error.
 */
function parse(source: string): { value: unknown; ok: boolean; message: string } {
  if (!source.trim()) return { value: null, ok: true, message: '' };
  try {
    return { value: JSON.parse(source), ok: true, message: '' };
  } catch (parseError) {
    return { value: undefined, ok: false, message: describe(parseError as Error, source) };
  }
}

/**
 * The engine's message names a character position; a person looks for a line.
 * V8 already appends "(line n column m)" in recent versions — then the message
 * is kept as is.
 */
function describe(parseError: Error, source: string): string {
  const message = parseError.message.replace(/^JSON\.parse: /, '');
  if (/line \d+ column \d+/.test(message)) return message;
  const position = /position (\d+)/.exec(message);
  if (!position) return message;
  const offset = Number(position[1]);
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return `${message} (line ${line}, column ${column})`;
}

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

// A model change from outside (another record selected, a save reloaded the
// row) replaces the text — unless the person is mid-edit on invalid text,
// which must not be thrown away under their cursor.
watch(
  model,
  (value) => {
    if (error.value) return;
    if (sameJson(parse(text.value).value, value)) return;
    text.value = format(value);
  },
  { immediate: true }
);

function onInput(value: string | undefined) {
  text.value = value ?? '';
  const result = parse(text.value);
  error.value = result.ok ? '' : result.message;
  if (result.ok) model.value = result.value;
}

const summary = computed(() => {
  const value = parse(text.value).value;
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  if (value && typeof value === 'object') return `${Object.keys(value).length} keys`;
  if (value == null) return 'Empty — saves as null';
  return typeof value;
});

defineExpose<B1ComponentExposed>({
  nativeInstance: computed(() => textareaRef.value)
});
</script>
