<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    aliases: string[];
    modelValue: string;
    disabled?: boolean;
    labelScope?: "jksToP12" | "p12ToJks";
  }>(),
  { labelScope: "jksToP12" }
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const { t } = useI18n();

const isSingle = computed(() => props.aliases.length === 1);

watch(
  () => props.aliases,
  (list) => {
    if (list.length === 1 && props.modelValue !== list[0]) {
      emit("update:modelValue", list[0]);
    }
    if (list.length > 0 && !list.includes(props.modelValue)) {
      emit("update:modelValue", "");
    }
  },
  { immediate: true }
);

function select(alias: string) {
  if (props.disabled) return;
  emit("update:modelValue", alias);
}
</script>

<template>
  <div class="picker">
    <div class="title">{{ t(`${props.labelScope}.aliasPickerTitle`) }}</div>
    <p v-if="isSingle" class="single">
      {{ t(`${props.labelScope}.singleAliasNotice`, { alias: aliases[0] }) }}
    </p>
    <p v-else class="hint">{{ t(`${props.labelScope}.aliasPickerHint`) }}</p>

    <ul v-if="!isSingle" class="list">
      <li v-for="alias in aliases" :key="alias">
        <label class="option" :class="{ selected: modelValue === alias }">
          <input
            type="radio"
            :name="'alias-picker'"
            :value="alias"
            :checked="modelValue === alias"
            :disabled="disabled"
            @change="select(alias)"
          />
          <span class="alias">{{ alias }}</span>
        </label>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.picker {
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px 16px; background: #f8fafc;
  border: 1px solid #e2e8f0; border-radius: 8px;
}
.title { font-weight: 600; font-size: 0.95rem; color: #1e293b; }
.hint { margin: 0; color: #64748b; font-size: 0.85rem; }
.single { margin: 0; color: #334155; font-size: 0.9rem; }
.list { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.option {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  border: 1px solid transparent; background: white;
}
.option:hover { background: #eff6ff; }
.option.selected { border-color: #2563eb; background: #eff6ff; }
.alias { font-family: Consolas, monospace; font-size: 0.9rem; color: #0f172a; }
</style>
