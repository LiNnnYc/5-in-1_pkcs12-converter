<script setup lang="ts">
import { computed, onActivated, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import Card from "../components/Card.vue";
import Row from "../components/Row.vue";
import FileField from "../components/FileField.vue";
import PasswordField from "../components/PasswordField.vue";
import Segmented from "../components/Segmented.vue";
import Alert from "../components/Alert.vue";
import ResultDisplay from "../components/ResultDisplay.vue";
import Icon from "../components/Icon.vue";
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

onActivated(() => {
  const payload = consume("extract");
  if (payload) {
    form.pfxFile = payload.pfxFile;
    form.pfxPassword = payload.pfxPassword;
  }
});

function resetAll() {
  form.pfxFile = "";
  form.pfxPassword = "";
  form.outputDir = "";
  form.certOutputMode = "merged";
  form.legacyMode = "auto";
  result.value = null;
}

const pfxFilters = [
  { name: t("dialog.filters.pfx"), extensions: ["pfx", "p12"] },
  { name: t("dialog.filters.all"), extensions: ["*"] }
];

const certOutputOptions = computed(() => [
  { value: "merged", label: t("extract.merged") },
  { value: "split", label: t("extract.split") }
]);

const legacyOptions = computed(() => [
  { value: "auto", label: t("extract.legacyAuto") },
  { value: "on", label: t("extract.legacyOn") },
  { value: "off", label: t("extract.legacyOff") }
]);

const canRun = computed(
  () => form.pfxFile.length > 0 && form.pfxPassword.length > 0 && form.outputDir.length > 0 && !busy.value
);

const hasUncertain = computed(
  () => result.value?.warnings?.some((w) => w.code === "LEGACY_MODE_UNCERTAIN") ?? false
);

const inlineStatus = computed(() => {
  if (busy.value) return t("extract.statusExtracting");
  if (result.value?.success) return t("extract.statusSuccess");
  if (result.value && !result.value.success) return t("extract.statusError");
  return "";
});

async function pickPfx() {
  const picked = await window.electronAPI.openFileDialog({
    filters: pfxFilters,
    title: t("dialog.selectPfx")
  });
  if (picked && picked[0]) form.pfxFile = picked[0];
}

async function pickOutputDir() {
  const picked = await window.electronAPI.openDirectoryDialog({
    title: t("dialog.selectOutputDir")
  });
  if (picked) form.outputDir = picked;
}

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
    <header class="page-head">
      <div class="head-main">
        <h1>{{ t("extract.pageTitle") }}</h1>
        <div class="crumb">{{ t("extract.crumb") }}</div>
      </div>
      <button type="button" class="btn btn-reset" :title="t('common.reset')" @click="resetAll">
        <Icon name="refresh" :size="14" />
        {{ t("common.reset") }}
      </button>
    </header>

    <Card :title="t('common.source')">
      <Row :label="t('extract.pfxFile')" required>
        <FileField
          :modelValue="form.pfxFile"
          @update:modelValue="(v: string) => (form.pfxFile = v)"
          @browse="pickPfx"
        />
      </Row>
      <Row :label="t('extract.pfxPassword')" required>
        <PasswordField
          :modelValue="form.pfxPassword"
          match-file
          @update:modelValue="(v: string) => (form.pfxPassword = v)"
        />
      </Row>
    </Card>

    <Card :title="t('common.output')">
      <Row :label="t('extract.outputDir')" required>
        <FileField
          :modelValue="form.outputDir"
          dir
          @update:modelValue="(v: string) => (form.outputDir = v)"
          @browse="pickOutputDir"
        />
      </Row>
      <Row :label="t('extract.certOutputMode')">
        <Segmented
          :modelValue="form.certOutputMode"
          :options="certOutputOptions"
          @update:modelValue="(v: string) => (form.certOutputMode = v as CertOutputMode)"
        />
      </Row>
      <Row :label="t('extract.legacyMode')" stack :hint="t('extract.legacyHint')">
        <select
          class="select legacy-select"
          :value="form.legacyMode"
          @change="(e) => (form.legacyMode = (e.target as HTMLSelectElement).value as LegacyMode)"
        >
          <option v-for="opt in legacyOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </Row>
      <template #foot>
        <button type="button" class="btn primary" :disabled="!canRun" @click="run">
          {{ busy ? t("common.loading") : t("extract.extractButton") }}
        </button>
        <span v-if="inlineStatus" class="inline-status" :class="{ success: result?.success, error: result && !result.success }">{{ inlineStatus }}</span>
        <span class="spacer-flex" />
      </template>
    </Card>

    <Alert v-if="hasUncertain" kind="warn">
      {{ t("warning.LEGACY_MODE_UNCERTAIN") }}
    </Alert>

    <ResultDisplay :result="result" />
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; }
.inline-status {
  font-size: 12px;
  color: var(--muted);
  margin-left: 4px;
}
.inline-status.success { color: var(--ok-ink); }
.inline-status.error { color: var(--err-ink); }
</style>
