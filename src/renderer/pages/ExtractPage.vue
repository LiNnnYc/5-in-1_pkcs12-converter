<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import FileSelector from "../components/FileSelector.vue";
import PasswordInput from "../components/PasswordInput.vue";
import ResultDisplay from "../components/ResultDisplay.vue";
import { useHandoff } from "../stores/handoff";
import type { CertOutputMode, LegacyMode, OperationResult } from "../../types";

const { t } = useI18n();
const { consume } = useHandoff();

const form = reactive({
  pfxFile: "",
  pfxPassword: "",
  outputDir: "",
  certOutputMode: "merged" as CertOutputMode,
  legacyMode: "auto" as LegacyMode
});

const busy = ref(false);
const result = ref<OperationResult | null>(null);

onMounted(() => {
  const payload = consume("extract");
  if (payload) {
    form.pfxFile = payload.pfxFile;
    form.pfxPassword = payload.pfxPassword;
  }
});

const pfxFilters = [
  { name: t("dialog.filters.pfx"), extensions: ["pfx", "p12"] },
  { name: t("dialog.filters.all"), extensions: ["*"] }
];

const canRun = computed(
  () => form.pfxFile.length > 0 && form.pfxPassword.length > 0 && form.outputDir.length > 0 && !busy.value
);

const hasUncertain = computed(
  () => result.value?.warnings?.some((w) => w.code === "LEGACY_MODE_UNCERTAIN") ?? false
);

async function run() {
  if (busy.value) return;
  result.value = null;
  busy.value = true;
  try {
    const res = await window.electronAPI.extractPkcs12({
      pfxFile: form.pfxFile,
      pfxPassword: form.pfxPassword,
      outputDir: form.outputDir,
      certOutputMode: form.certOutputMode,
      legacyMode: form.legacyMode
    });
    result.value = res;
  } catch {
    result.value = { success: false, message: "error.internalError" };
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="page">
    <h2>{{ t("extract.pageTitle") }}</h2>

    <div class="grid">
      <FileSelector
        v-model="form.pfxFile"
        :label="t('extract.pfxFile')"
        :filters="pfxFilters"
        :title="t('dialog.selectPfx')"
        :disabled="busy"
      />
      <PasswordInput
        v-model="form.pfxPassword"
        :label="t('extract.pfxPassword')"
        :disabled="busy"
      />
      <FileSelector
        v-model="form.outputDir"
        :label="t('extract.outputDir')"
        :title="t('dialog.selectOutputDir')"
        mode="directory"
        :disabled="busy"
      />

      <div class="field">
        <label class="label">{{ t("extract.certOutputMode") }}</label>
        <div class="radios">
          <label class="radio">
            <input type="radio" v-model="form.certOutputMode" value="merged" :disabled="busy" />
            {{ t("extract.merged") }}
          </label>
          <label class="radio">
            <input type="radio" v-model="form.certOutputMode" value="split" :disabled="busy" />
            {{ t("extract.split") }}
          </label>
        </div>
      </div>

      <div class="field full">
        <label class="label">{{ t("extract.legacyMode") }}</label>
        <div class="radios">
          <label class="radio">
            <input type="radio" v-model="form.legacyMode" value="auto" :disabled="busy" />
            {{ t("extract.legacyAuto") }}
          </label>
          <label class="radio">
            <input type="radio" v-model="form.legacyMode" value="on" :disabled="busy" />
            {{ t("extract.legacyOn") }}
          </label>
          <label class="radio">
            <input type="radio" v-model="form.legacyMode" value="off" :disabled="busy" />
            {{ t("extract.legacyOff") }}
          </label>
        </div>
        <p class="hint">{{ t("extract.legacyHint") }}</p>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="btn primary" :disabled="!canRun" @click="run">
        {{ busy ? t("common.loading") : t("extract.extractButton") }}
      </button>
    </div>

    <div v-if="hasUncertain" class="uncertain">
      {{ t("warning.LEGACY_MODE_UNCERTAIN") }}
    </div>

    <ResultDisplay :result="result" />
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
h2 { margin: 0; font-size: 1.25rem; color: #0f172a; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field.full { grid-column: 1 / -1; }
.label { font-weight: 600; font-size: 0.92rem; color: #1e293b; }
.radios { display: flex; gap: 16px; flex-wrap: wrap; }
.radio { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; cursor: pointer; }
.hint { margin: 2px 0 0; color: #64748b; font-size: 0.82rem; }
.actions { display: flex; gap: 10px; margin-top: 6px; }
.btn {
  padding: 8px 18px; border-radius: 6px; border: 1px solid #cbd5e1;
  background: #f8fafc; cursor: pointer; font-size: 0.95rem;
}
.btn:hover:not(:disabled) { background: #e2e8f0; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.primary { background: #2563eb; border-color: #2563eb; color: white; }
.btn.primary:hover:not(:disabled) { background: #1d4ed8; }
.uncertain {
  padding: 10px 14px; background: #fef3c7; border: 1px solid #fde68a;
  border-radius: 8px; color: #92400e; font-size: 0.9rem;
}
</style>
