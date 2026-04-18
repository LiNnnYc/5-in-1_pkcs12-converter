<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

type FilterSpec = { name: string; extensions: string[] };

const props = defineProps<{
  label: string;
  modelValue: string | string[];
  filters?: FilterSpec[];
  multiple?: boolean;
  mode?: "open" | "save" | "directory";
  title?: string;
  defaultName?: string;
  optional?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string | string[]): void;
}>();

const { t } = useI18n();

const isMultiple = computed(() => props.multiple === true);
const isSave = computed(() => props.mode === "save");
const isDirectory = computed(() => props.mode === "directory");

const files = computed<string[]>(() => {
  if (Array.isArray(props.modelValue)) return props.modelValue;
  return props.modelValue ? [props.modelValue] : [];
});

async function browse() {
  if (isDirectory.value) {
    const path = await window.electronAPI.openDirectoryDialog({ title: props.title });
    if (path) emit("update:modelValue", path);
    return;
  }
  if (isSave.value) {
    const path = await window.electronAPI.saveFileDialog({
      filters: props.filters,
      defaultName: props.defaultName,
      title: props.title
    });
    if (path) emit("update:modelValue", path);
    return;
  }
  const picked = await window.electronAPI.openFileDialog({
    filters: props.filters,
    multiSelect: isMultiple.value,
    title: props.title
  });
  if (!picked || picked.length === 0) return;
  if (isMultiple.value) {
    const existing = Array.isArray(props.modelValue) ? props.modelValue : [];
    const merged = Array.from(new Set([...existing, ...picked]));
    emit("update:modelValue", merged);
  } else {
    emit("update:modelValue", picked[0]);
  }
}

function removeAt(index: number) {
  if (!isMultiple.value) {
    emit("update:modelValue", "");
    return;
  }
  const current = Array.isArray(props.modelValue) ? [...props.modelValue] : [];
  current.splice(index, 1);
  emit("update:modelValue", current);
}

function clearSingle() {
  emit("update:modelValue", "");
}
</script>

<template>
  <div class="field">
    <label class="label">
      {{ label }}
      <span v-if="optional" class="optional">{{ t("common.optional") }}</span>
    </label>

    <div class="row">
      <button type="button" class="btn" :disabled="disabled" @click="browse">
        {{ isSave ? t("common.save") : t("common.browse") }}
      </button>
      <span v-if="!isMultiple && files.length === 0" class="empty">—</span>
    </div>

    <ul v-if="files.length > 0" class="files" :class="{ single: !isMultiple }">
      <li v-for="(f, i) in files" :key="f + i" class="file">
        <span class="path" :title="f">{{ f }}</span>
        <button
          type="button"
          class="link"
          @click="isMultiple ? removeAt(i) : clearSingle()"
        >
          {{ t("common.remove") }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.field { display: flex; flex-direction: column; gap: 6px; }
.label { font-weight: 600; font-size: 0.92rem; color: #1e293b; }
.optional { margin-left: 4px; color: #64748b; font-weight: 400; font-size: 0.85rem; }
.row { display: flex; align-items: center; gap: 10px; }
.btn {
  padding: 6px 14px; border-radius: 6px; border: 1px solid #cbd5e1;
  background: #f8fafc; cursor: pointer; font-size: 0.9rem;
}
.btn:hover:not(:disabled) { background: #e2e8f0; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.empty { color: #94a3b8; font-size: 0.9rem; }
.files { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.file {
  display: flex; justify-content: space-between; gap: 12px;
  padding: 6px 10px; background: #f1f5f9; border-radius: 6px;
  font-size: 0.85rem; color: #334155;
}
.path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; font-family: Consolas, monospace; }
.link {
  border: none; background: none; color: #2563eb; cursor: pointer; font-size: 0.85rem; padding: 0;
}
.link:hover { text-decoration: underline; }
</style>
