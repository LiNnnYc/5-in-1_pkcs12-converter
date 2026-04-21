<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import Icon from "./Icon.vue";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    matchFile?: boolean;
    fileMode?: "browse" | "save" | "dir";
    autocomplete?: string;
  }>(),
  { placeholder: "", matchFile: false, fileMode: "browse", autocomplete: "off" }
);

const spacerLabel = computed(() => {
  if (props.fileMode === "save") return t("common.save");
  if (props.fileMode === "dir") return t("common.selectDir");
  return t("common.browse");
});

const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
}>();

const reveal = ref(false);
</script>

<template>
  <div class="pwd-wrap" :class="{ 'match-file': matchFile }">
    <div class="pwd-inner">
      <input
        class="input"
        :type="reveal ? 'text' : 'password'"
        :value="modelValue"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        spellcheck="false"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <button
        type="button"
        class="pwd-toggle"
        :title="reveal ? $t('common.hide') : $t('common.show')"
        :aria-label="reveal ? $t('common.hide') : $t('common.show')"
        @click="reveal = !reveal"
      >
        <Icon :name="reveal ? 'eyeOff' : 'eye'" :size="15" />
      </button>
    </div>
    <button v-if="matchFile" type="button" class="btn sm spacer" tabindex="-1" aria-hidden="true">
      <Icon :name="fileMode === 'dir' ? 'folder' : 'file'" :size="13" />
      {{ spacerLabel }}
    </button>
  </div>
</template>

<style scoped>
.pwd-wrap { position: relative; width: 100%; }
.pwd-wrap.match-file { display: flex; align-items: center; gap: 8px; }
.pwd-wrap.match-file .pwd-inner { position: relative; flex: 1; min-width: 0; }
.pwd-wrap:not(.match-file) .pwd-inner { position: relative; }

.input {
  width: 100%;
  padding: 6px 32px 6px 10px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: white;
  font-family: var(--font-mono);
}
.input:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }

.pwd-toggle {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--muted);
  display: grid;
  place-items: center;
  padding: 0;
}
.pwd-toggle:hover { background: #eef2f6; color: var(--ink-2); }

.spacer {
  visibility: hidden;
  pointer-events: none;
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  background: white;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
