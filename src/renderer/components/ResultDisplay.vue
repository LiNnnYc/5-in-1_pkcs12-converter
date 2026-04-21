<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Alert from "./Alert.vue";
import Icon from "./Icon.vue";
import type { OperationResult } from "../../types";

const props = defineProps<{
  result: OperationResult | null;
}>();

const { t } = useI18n();
const sessionId = ref<string>("");
const rootEl = ref<HTMLElement | null>(null);

watch(
  () => props.result,
  async (r) => {
    if (!r) return;
    await nextTick();
    rootEl.value?.scrollIntoView({ behavior: "smooth", block: "end" });
  }
);

onMounted(async () => {
  try {
    sessionId.value = await window.electronAPI.getSessionId();
  } catch {
    sessionId.value = "";
  }
});

const translatedMessage = computed(() => {
  const m = props.result?.message ?? "";
  if (!m) return "";
  if (m.startsWith("error.") || m.startsWith("common.")) return t(m);
  return m;
});

const revealTarget = computed(() => {
  const files = props.result?.outputFiles;
  return files && files.length > 0 ? files[0] : "";
});

function reveal() {
  if (!revealTarget.value) return;
  window.electronAPI.revealPath(revealTarget.value);
}
</script>

<template>
  <section v-if="result" ref="rootEl" class="result">
    <Alert :kind="result.success ? 'ok' : 'err'" :title="result.success ? t('common.success') : t('common.failure')">
      <div class="msg">{{ translatedMessage }}</div>

      <div v-if="result.outputFiles && result.outputFiles.length" class="files">
        <ul>
          <li v-for="f in result.outputFiles" :key="f" class="path">{{ f }}</li>
        </ul>
      </div>

      <p v-if="!result.success && sessionId" class="session">
        {{ t("common.reportSession", { id: sessionId }) }}
      </p>
    </Alert>

    <div v-if="result.success && revealTarget" class="actions">
      <button type="button" class="btn sm" @click="reveal">
        <Icon name="folder" :size="14" />
        {{ t("common.openOutputDir") }}
      </button>
      <slot name="actions" />
    </div>
    <div v-else-if="$slots.actions" class="actions">
      <slot name="actions" />
    </div>

    <slot />
  </section>
</template>

<style scoped>
.result { margin-top: 14px; padding-bottom: 12px; display: flex; flex-direction: column; gap: 10px; }
.msg { margin: 0 0 4px; font-size: 12.5px; }
.files ul { margin: 4px 0 0; padding-left: 16px; }
.path { font-family: var(--font-mono, Consolas, monospace); font-size: 12px; word-break: break-all; }
.session { margin: 8px 0 0; font-size: 11.5px; opacity: 0.78; font-family: var(--font-mono, Consolas, monospace); }
.actions {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}
.actions .btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
