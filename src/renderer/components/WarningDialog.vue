<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { OperationWarning, WarningCode } from "../../types";

const props = defineProps<{
  warnings: OperationWarning[];
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "confirm", codes: WarningCode[]): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();
const confirmed = ref<Record<string, boolean>>({});

watch(
  () => props.visible,
  (v) => {
    if (v) confirmed.value = {};
  }
);

const mustConfirm = computed(() => props.warnings.filter((w) => w.requiresConfirmation));
const informational = computed(() => props.warnings.filter((w) => !w.requiresConfirmation));

const allConfirmed = computed(() =>
  mustConfirm.value.every((w) => confirmed.value[w.code])
);

// Pull the subject list a chain-related warning carries in `details`. Both
// `subjects: string[]` (REORDERED / EXTRA / DUPLICATE) and `subject: string`
// (ANCHOR) are normalized to a single array so the template can render the
// affected certs uniformly.
function subjectsOf(w: OperationWarning): string[] {
  const d = w.details;
  if (!d) return [];
  if (Array.isArray(d.subjects)) return d.subjects.filter((x): x is string => typeof x === "string");
  if (typeof d.subject === "string") return [d.subject];
  return [];
}

function confirm() {
  const codes = props.warnings.filter((w) => confirmed.value[w.code]).map((w) => w.code);
  emit("confirm", codes);
}
</script>

<template>
  <div v-if="visible" class="overlay" role="dialog" aria-modal="true">
    <div class="modal">
      <h2>{{ t("warning.title") }}</h2>
      <p class="desc">{{ t("warning.description") }}</p>

      <ul class="list">
        <li v-for="w in mustConfirm" :key="w.code" class="item required">
          <label>
            <input type="checkbox" v-model="confirmed[w.code]" />
            <strong>{{ t(`warning.${w.code}`) }}</strong>
          </label>
          <p v-if="w.message" class="msg">{{ w.message }}</p>
          <ul v-if="subjectsOf(w).length > 0" class="subjects">
            <li v-for="s in subjectsOf(w)" :key="s" class="subject" :title="s">{{ s }}</li>
          </ul>
        </li>
        <li v-for="w in informational" :key="w.code" class="item info">
          <strong>{{ t(`warning.${w.code}`) }}</strong>
          <p v-if="w.message" class="msg">{{ w.message }}</p>
          <ul v-if="subjectsOf(w).length > 0" class="subjects">
            <li v-for="s in subjectsOf(w)" :key="s" class="subject" :title="s">{{ s }}</li>
          </ul>
        </li>
      </ul>

      <div class="actions">
        <button type="button" class="btn" @click="emit('cancel')">
          {{ t("common.cancel") }}
        </button>
        <button
          type="button"
          class="btn primary"
          :disabled="!allConfirmed"
          @click="confirm"
        >
          {{ t("common.continue") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
  display: grid; place-items: center; z-index: 100;
}
.modal {
  width: min(560px, 90vw); max-height: 80vh; overflow: auto;
  background: white; border-radius: 12px; padding: 24px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}
h2 { margin: 0 0 6px; font-size: 1.15rem; color: #1e293b; }
.desc { margin: 0 0 14px; color: #64748b; font-size: 0.9rem; }
.list { list-style: none; margin: 0 0 18px; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.item { padding: 10px 12px; border-radius: 8px; border: 1px solid #e2e8f0; }
.item.required { background: #fef3c7; border-color: #fde68a; }
.item.info { background: #f1f5f9; }
.item label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.msg { margin: 4px 0 0 24px; font-size: 0.85rem; color: #475569; }
.subjects {
  margin: 6px 0 0 24px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.subject {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 0.78rem;
  color: #334155;
  background: rgba(255, 255, 255, 0.6);
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.actions { display: flex; justify-content: flex-end; gap: 10px; }
.btn {
  padding: 7px 16px; border-radius: 6px; border: 1px solid #cbd5e1;
  background: #f8fafc; cursor: pointer; font-size: 0.92rem;
}
.btn:hover:not(:disabled) { background: #e2e8f0; }
.btn.primary { background: #2563eb; border-color: #2563eb; color: white; }
.btn.primary:hover:not(:disabled) { background: #1d4ed8; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
