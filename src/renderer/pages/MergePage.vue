<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import FileSelector from "../components/FileSelector.vue";
import PasswordInput from "../components/PasswordInput.vue";
import WarningDialog from "../components/WarningDialog.vue";
import ResultDisplay from "../components/ResultDisplay.vue";
import { useHandoff } from "../stores/handoff";
import type {
  MergePrecheckResult,
  OperationResult,
  OperationWarning,
  Pkcs12Algorithm,
  WarningCode
} from "../../types";

const { t } = useI18n();
const { navigate } = useHandoff();

function handoffToJks() {
  if (!form.outputFile || !form.exportPassword) return;
  navigate("jksFromP12", {
    target: "jksFromP12",
    pfxFile: form.outputFile,
    pfxPassword: form.exportPassword
  });
}

type State =
  | "idle"
  | "prechecking"
  | "warnings"
  | "merging"
  | "success"
  | "error";

const form = reactive({
  privateKeyFile: "",
  privateKeyPassword: "",
  serverCertFile: "",
  chainCertFiles: [] as string[],
  exportPassword: "",
  algorithm: "AES-256-CBC" as Pkcs12Algorithm,
  outputFile: ""
});

const state = ref<State>("idle");
const precheck = ref<MergePrecheckResult | null>(null);
const warnings = ref<OperationWarning[]>([]);
const result = ref<OperationResult | null>(null);
const warningVisible = ref(false);

const keyFilters = [
  { name: t("dialog.filters.key"), extensions: ["key", "pem"] },
  { name: t("dialog.filters.all"), extensions: ["*"] }
];
const certFilters = [
  { name: t("dialog.filters.cert"), extensions: ["pem", "crt", "cer"] },
  { name: t("dialog.filters.all"), extensions: ["*"] }
];
const chainFilters = [
  { name: t("dialog.filters.chain"), extensions: ["pem", "crt", "cer", "der"] },
  { name: t("dialog.filters.all"), extensions: ["*"] }
];
const pfxFilters = [
  { name: t("dialog.filters.pfx"), extensions: ["pfx", "p12"] },
  { name: t("dialog.filters.all"), extensions: ["*"] }
];

const canPrecheck = computed(
  () =>
    form.privateKeyFile.length > 0 &&
    form.serverCertFile.length > 0 &&
    form.exportPassword.length > 0 &&
    form.outputFile.length > 0 &&
    state.value !== "prechecking" &&
    state.value !== "merging"
);

const busy = computed(() => state.value === "prechecking" || state.value === "merging");

async function runPrecheck() {
  if (state.value === "prechecking" || state.value === "merging") return;
  result.value = null;
  precheck.value = null;
  warnings.value = [];
  state.value = "prechecking";
  try {
    const res = await window.electronAPI.mergePkcs12Precheck({
      privateKeyFile: form.privateKeyFile,
      privateKeyPassword: form.privateKeyPassword || undefined,
      serverCertFile: form.serverCertFile,
      chainCertFiles: form.chainCertFiles
    });
    if (!res.success) {
      result.value = res;
      state.value = "error";
      return;
    }
    precheck.value = res.details ?? null;
    warnings.value = res.warnings ?? [];
    const requires = warnings.value.filter((w) => w.requiresConfirmation);
    if (requires.length > 0 || warnings.value.length > 0) {
      state.value = "warnings";
      warningVisible.value = true;
    } else {
      await executeMerge([]);
    }
  } catch {
    result.value = { success: false, message: "error.internalError" };
    state.value = "error";
  }
}

async function executeMerge(confirmedCodes: WarningCode[]) {
  if (state.value === "merging") return;
  if (!precheck.value) {
    state.value = "error";
    return;
  }
  state.value = "merging";
  try {
    const res = await window.electronAPI.mergePkcs12({
      privateKeyFile: form.privateKeyFile,
      privateKeyPassword: form.privateKeyPassword || undefined,
      serverCertFile: form.serverCertFile,
      chainCertFiles: form.chainCertFiles,
      precheckToken: precheck.value.precheckToken,
      confirmedWarningCodes: confirmedCodes,
      exportPassword: form.exportPassword,
      algorithm: form.algorithm,
      outputFile: form.outputFile
    });
    result.value = res;
    state.value = res.success ? "success" : "error";
  } catch {
    result.value = { success: false, message: "error.internalError" };
    state.value = "error";
  }
}

function onWarningsConfirm(codes: WarningCode[]) {
  warningVisible.value = false;
  executeMerge(codes);
}

function onWarningsCancel() {
  warningVisible.value = false;
  state.value = "idle";
}

function reset() {
  state.value = "idle";
  result.value = null;
  precheck.value = null;
  warnings.value = [];
}
</script>

<template>
  <section class="page">
    <h2>{{ t("merge.pageTitle") }}</h2>

    <div class="grid">
      <FileSelector
        v-model="form.privateKeyFile"
        :label="t('merge.privateKey')"
        :filters="keyFilters"
        :title="t('dialog.selectPrivateKey')"
        :disabled="busy"
      />
      <PasswordInput
        v-model="form.privateKeyPassword"
        :label="t('merge.privateKeyPassword')"
        :hint="t('merge.privateKeyPasswordHint')"
        optional
        :disabled="busy"
      />

      <FileSelector
        v-model="form.serverCertFile"
        :label="t('merge.serverCert')"
        :filters="certFilters"
        :title="t('dialog.selectCert')"
        :disabled="busy"
      />
      <FileSelector
        v-model="form.chainCertFiles"
        :label="t('merge.chainCerts')"
        :filters="chainFilters"
        :title="t('dialog.selectChain')"
        multiple
        :disabled="busy"
      />

      <PasswordInput
        v-model="form.exportPassword"
        :label="t('merge.exportPassword')"
        :disabled="busy"
      />

      <div class="field">
        <label class="label">{{ t("merge.algorithm") }}</label>
        <select v-model="form.algorithm" class="select" :disabled="busy">
          <option value="AES-256-CBC">{{ t("merge.algorithmAes") }}</option>
          <option value="PBE-SHA1-3DES">{{ t("merge.algorithmLegacy") }}</option>
        </select>
      </div>

      <FileSelector
        v-model="form.outputFile"
        :label="t('merge.outputFile')"
        :filters="pfxFilters"
        :title="t('dialog.selectOutput')"
        mode="save"
        defaultName="output.pfx"
        :disabled="busy"
      />
    </div>

    <div class="actions">
      <button type="button" class="btn primary" :disabled="!canPrecheck" @click="runPrecheck">
        {{ state === "prechecking" ? t("common.loading") : t("merge.precheckButton") }}
      </button>
      <button type="button" class="btn" :disabled="busy" @click="reset">
        {{ t("common.cancel") }}
      </button>
    </div>

    <WarningDialog
      :warnings="warnings"
      :visible="warningVisible"
      @confirm="onWarningsConfirm"
      @cancel="onWarningsCancel"
    />

    <ResultDisplay :result="result">
      <div v-if="result && result.success" class="followup">
        <button type="button" class="btn" @click="handoffToJks">
          {{ t("merge.toJksButton") }}
        </button>
      </div>
    </ResultDisplay>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
h2 { margin: 0; font-size: 1.25rem; color: #0f172a; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.label { font-weight: 600; font-size: 0.92rem; color: #1e293b; }
.select {
  padding: 7px 10px; border-radius: 6px; border: 1px solid #cbd5e1;
  background: white; font-size: 0.92rem;
}
.actions { display: flex; gap: 10px; margin-top: 6px; }
.btn {
  padding: 8px 18px; border-radius: 6px; border: 1px solid #cbd5e1;
  background: #f8fafc; cursor: pointer; font-size: 0.95rem;
}
.btn:hover:not(:disabled) { background: #e2e8f0; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.primary { background: #2563eb; border-color: #2563eb; color: white; }
.btn.primary:hover:not(:disabled) { background: #1d4ed8; }
.followup { margin-top: 12px; }
</style>
