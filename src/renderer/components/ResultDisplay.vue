<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ref, onMounted } from "vue";
import type { OperationResult } from "../../types";

defineProps<{
  result: OperationResult | null;
}>();

const { t } = useI18n();
const sessionId = ref<string>("");

onMounted(async () => {
  try {
    sessionId.value = await window.electronAPI.getSessionId();
  } catch {
    sessionId.value = "";
  }
});

function translateMessage(msg: string): string {
  if (!msg) return "";
  if (msg.startsWith("error.") || msg.startsWith("common.")) {
    return t(msg);
  }
  return msg;
}
</script>

<template>
  <section v-if="result" class="result" :class="result.success ? 'ok' : 'fail'">
    <header class="head">
      <span class="icon">{{ result.success ? "✓" : "✕" }}</span>
      <h3>{{ result.success ? t("common.success") : t("common.failure") }}</h3>
    </header>
    <p class="msg">{{ translateMessage(result.message) }}</p>

    <div v-if="result.outputFiles && result.outputFiles.length" class="files">
      <p class="label">Output:</p>
      <ul>
        <li v-for="f in result.outputFiles" :key="f" class="path">{{ f }}</li>
      </ul>
    </div>

    <p v-if="!result.success && sessionId" class="session">{{ t("common.reportSession", { id: sessionId }) }}</p>

    <slot />
  </section>
</template>

<style scoped>
.result {
  margin-top: 18px; padding: 16px 18px; border-radius: 10px; border: 1px solid;
}
.result.ok { background: #ecfdf5; border-color: #6ee7b7; color: #065f46; }
.result.fail { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }
.head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.icon {
  width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
  font-weight: 700; color: white;
}
.ok .icon { background: #10b981; }
.fail .icon { background: #ef4444; }
h3 { margin: 0; font-size: 1rem; }
.msg { margin: 0 0 8px; font-size: 0.92rem; }
.files .label { margin: 8px 0 4px; font-weight: 600; font-size: 0.85rem; }
.files ul { margin: 0; padding-left: 16px; }
.path { font-family: Consolas, monospace; font-size: 0.85rem; word-break: break-all; }
.session { margin: 10px 0 0; font-size: 0.8rem; opacity: 0.75; font-family: Consolas, monospace; }
</style>
