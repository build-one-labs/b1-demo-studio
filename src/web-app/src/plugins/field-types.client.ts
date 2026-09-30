/**
 * The Studio's own form field types.
 *
 * A form renders its fields through the framework's field factory: each
 * registered type guard is asked in turn whether it handles an element, and the
 * first match wins over the built-in v-if chain. The guard keys on the object
 * type's `uiComponentAlias` — the same string the blueprint object type
 * `b1_json_field` carries — which is the only coupling between the metadata in
 * the blueprint database and this code (see .claude/skills/b1-implement-object-type).
 *
 * Client-only: the field factory registry lives in the browser bundle.
 */
import { registerNewFieldTypeComponent } from '@buildone/web-core';

import type { FormElement } from '@buildone/web-core';

export default defineNuxtPlugin(() => {
  registerNewFieldTypeComponent(
    () => import('~/components/B1JsonField.vue'),
    (element: FormElement) => element.blueprint?.objectType === 'jsonField'
  );
});
