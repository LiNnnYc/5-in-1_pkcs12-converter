<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

defineProps<{
  label: string;
  modelValue: string;
  placeholder?: string;
  optional?: boolean;
  hint?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const { t } = useI18n();
const reveal = ref(false);

function onInput(e: Event) {
  emit("update:modelValue", (e.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="field">
    <label class="label">
      {{ label }}
      <span v-if="optional" class="optional">{{ t("common.optional") }}</span>
    </label>
    <div class="row">
      <input
        class="input"
        :type="reveal ? 'text' : 'password'"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        spellcheck="false"
        @input="onInput"
      />
      <button type="button" class="btn" :disabled="disabled" @click="reveal = !reveal">
        {{ reveal ? t("common.hide") : t("common.show") }}
      </button>
    </div>
    <p v-if="hint" class="hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.field { display: flex; flex-direction: column; gap: 6px; }
.label { font-weight: 600; font-size: 0.92rem; color: #1e293b; }
.optional { margin-left: 4px; color: #64748b; font-weight: 400; font-size: 0.85rem; }
.row { display: flex; gap: 8px; }
.input {
  flex: 1; padding: 7px 10px; border-radius: 6px; border: 1px solid #cbd5e1;
  font-family: Consolas, monospace; font-size: 0.92rem; background: white;
}
.input:focus { outline: none; border-color: #2563eb; }
.btn {
  padding: 6px 12px; border-radius: 6px; border: 1px solid #cbd5e1;
  background: #f8fafc; cursor: pointer; font-size: 0.85rem; min-width: 60px;
}
.btn:hover:not(:disabled) { background: #e2e8f0; }
.hint { margin: 2px 0 0; color: #64748b; font-size: 0.82rem; }
</style>
