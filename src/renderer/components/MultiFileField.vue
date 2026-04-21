<script setup lang="ts">
import { useI18n } from "vue-i18n";
import Icon from "./Icon.vue";

const { t } = useI18n();

const props = defineProps<{
  modelValue: string[];
  placeholder?: string;
  addLabel?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: string[]): void;
  (e: "browse"): void;
}>();

function remove(idx: number) {
  emit("update:modelValue", props.modelValue.filter((_, i) => i !== idx));
}
</script>

<template>
  <div class="file-multi">
    <div class="header">
      <button type="button" class="btn sm" @click="emit('browse')">
        <Icon name="file" :size="13" />
        {{ addLabel ?? t("common.addFile") }}
      </button>
      <span class="status">
        {{ modelValue.length > 0 ? `已加入 ${modelValue.length} 個` : (placeholder ?? "尚未加入任何檔案") }}
      </span>
    </div>
    <div v-if="modelValue.length > 0" class="chip-list">
      <div v-for="(v, i) in modelValue" :key="`${v}-${i}`" class="chip">
        <span class="p">{{ v }}</span>
        <button type="button" :aria-label="$t('common.remove')" @click="remove(i)">×</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-multi { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.header { display: flex; align-items: center; gap: 8px; }
.status { color: var(--muted); font-size: 12px; }
.chip-list { display: flex; flex-direction: column; gap: 3px; }
.chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 10px;
  background: var(--chip);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--chip-ink);
}
.chip .p {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
  direction: rtl;
  text-align: left;
}
.chip button {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--muted);
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
}
.chip button:hover { background: #dfe3eb; color: var(--ink-2); }

.btn {
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-2);
  background: white;
  cursor: pointer;
  font-size: 12px;
  color: var(--ink-2);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.btn:hover { background: #f1f5f9; border-color: #94a3b8; }
</style>
