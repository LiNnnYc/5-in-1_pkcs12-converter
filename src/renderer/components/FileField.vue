<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Icon from "./Icon.vue";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    saveMode?: boolean;
    dir?: boolean;
    browseLabel?: string;
  }>(),
  {
    placeholder: "—",
    saveMode: false,
    dir: false,
    browseLabel: ""
  }
);

const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
  (e: "browse"): void;
}>();

const empty = computed(() => !props.modelValue);
const label = computed(() => {
  if (props.browseLabel) return props.browseLabel;
  if (props.saveMode) return t("common.save");
  if (props.dir) return t("common.selectDir");
  return t("common.browse");
});
const icon = computed(() => (props.dir ? "folder" : "file"));
</script>

<template>
  <div class="file">
    <div class="path-wrap">
      <div class="path" :class="{ empty }">
        {{ empty ? placeholder : modelValue }}
      </div>
      <button
        v-if="!empty"
        type="button"
        class="field-clear"
        :title="$t('common.remove')"
        :aria-label="$t('common.remove')"
        @click="emit('update:modelValue', '')"
      >
        <Icon name="x" :size="13" />
      </button>
    </div>
    <button type="button" class="btn sm" @click="emit('browse')">
      <Icon :name="icon" :size="13" />
      {{ label }}
    </button>
  </div>
</template>

<style scoped>
.file {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.path-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}
.path {
  width: 100%;
  padding: 6px 28px 6px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fafbfc;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
.path.empty {
  color: var(--muted-2);
  font-family: var(--font-sans);
  direction: ltr;
  font-style: italic;
  padding-right: 10px;
}
.field-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--muted-2);
  display: grid;
  place-items: center;
  padding: 0;
}
.field-clear:hover { background: #e2e8f0; color: var(--ink-2); }

.btn {
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-2);
  background: white;
  cursor: pointer;
  font-size: 12.5px;
  color: var(--ink-2);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.btn:hover { background: #f1f5f9; border-color: #94a3b8; }
.btn.sm { padding: 4px 10px; font-size: 12px; }
</style>
