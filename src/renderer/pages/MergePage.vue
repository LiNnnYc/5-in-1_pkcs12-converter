<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import Card from "../components/Card.vue";
import Row from "../components/Row.vue";
import FileField from "../components/FileField.vue";
import MultiFileField from "../components/MultiFileField.vue";
import PasswordField from "../components/PasswordField.vue";
import WarningDialog from "../components/WarningDialog.vue";
import ResultDisplay from "../components/ResultDisplay.vue";
import Icon from "../components/Icon.vue";
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

const algorithmOptions = computed(() => [
  { value: "AES-256-CBC", label: t("merge.algorithmAes") },
  { value: "PBE-SHA1-3DES", label: t("merge.algorithmLegacy") }
]);

// Keystore-style minimum for user-created PFX export password. Must stay in
// sync with validateKeystorePassword() on the main side — front-end disables
// the action so users get immediate feedback instead of a round-trip error.
const EXPORT_PASSWORD_MIN_LENGTH = 6;

const canPrecheck = computed(
  () =>
    form.privateKeyFile.length > 0 &&
    form.serverCertFile.length > 0 &&
    form.exportPassword.length >= EXPORT_PASSWORD_MIN_LENGTH &&
    form.outputFile.length > 0 &&
    state.value !== "prechecking" &&
    state.value !== "merging"
);

const busy = computed(() => state.value === "prechecking" || state.value === "merging");

const canHandoffJks = computed(
  () => state.value === "success" && !!form.outputFile && !!form.exportPassword
);

const canRollback = computed(() => state.value !== "idle");

const inlineStatus = computed(() => {
  switch (state.value) {
    case "prechecking": return t("merge.statusPrechecking");
    case "merging": return t("merge.statusMerging");
    case "success": return t("merge.statusSuccess");
    case "error": return t("merge.statusError");
    default: return "";
  }
});

async function pickPrivateKey() {
  const picked = await window.electronAPI.openFileDialog({
    filters: keyFilters,
    title: t("dialog.selectPrivateKey")
  });
  if (picked && picked[0]) form.privateKeyFile = picked[0];
}

async function pickServerCert() {
  const picked = await window.electronAPI.openFileDialog({
    filters: certFilters,
    title: t("dialog.selectCert")
  });
  if (picked && picked[0]) form.serverCertFile = picked[0];
}

async function pickChain() {
  const picked = await window.electronAPI.openFileDialog({
    filters: chainFilters,
    multiSelect: true,
    title: t("dialog.selectChain")
  });
  if (!picked || picked.length === 0) return;
  form.chainCertFiles = Array.from(new Set([...form.chainCertFiles, ...picked]));
}

async function pickOutput() {
  const picked = await window.electronAPI.saveFileDialog({
    filters: pfxFilters,
    defaultName: "output.pfx",
    title: t("dialog.selectOutput")
  });
  if (picked) form.outputFile = picked;
}

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
      chainCertFiles: [...form.chainCertFiles]
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
      chainCertFiles: [...form.chainCertFiles],
      precheckToken: precheck.value.precheckToken,
      confirmedWarningCodes: [...confirmedCodes],
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

function resetAll() {
  form.privateKeyFile = "";
  form.privateKeyPassword = "";
  form.serverCertFile = "";
  form.chainCertFiles = [];
  form.exportPassword = "";
  form.algorithm = "AES-256-CBC";
  form.outputFile = "";
  warningVisible.value = false;
  reset();
}

function handoffToJks() {
  if (!form.outputFile || !form.exportPassword) return;
  navigate("jksFromP12", {
    target: "jksFromP12",
    pfxFile: form.outputFile,
    pfxPassword: form.exportPassword
  });
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="head-main">
        <h1>{{ t("merge.pageTitle") }}</h1>
        <div class="crumb">{{ t("merge.crumb") }}</div>
      </div>
      <button type="button" class="btn btn-reset" :title="t('common.reset')" @click="resetAll">
        <Icon name="refresh" :size="14" />
        {{ t("common.reset") }}
      </button>
    </header>

    <Card :title="t('common.source')">
      <Row :label="t('merge.privateKey')" required>
        <FileField
          :modelValue="form.privateKeyFile"
          @update:modelValue="(v: string) => (form.privateKeyFile = v)"
          @browse="pickPrivateKey"
        />
      </Row>
      <Row :label="t('merge.privateKeyPassword')" optional :hint="t('merge.privateKeyPasswordHint')">
        <PasswordField
          :modelValue="form.privateKeyPassword"
          match-file
          @update:modelValue="(v: string) => (form.privateKeyPassword = v)"
        />
      </Row>
      <Row :label="t('merge.serverCert')" required>
        <FileField
          :modelValue="form.serverCertFile"
          @update:modelValue="(v: string) => (form.serverCertFile = v)"
          @browse="pickServerCert"
        />
      </Row>
      <Row :label="t('merge.chainCerts')" stack :hint="t('merge.chainCertsHint')">
        <MultiFileField
          :modelValue="form.chainCertFiles"
          @update:modelValue="(v: string[]) => (form.chainCertFiles = v)"
          @browse="pickChain"
        />
      </Row>
    </Card>

    <Card :title="t('common.output')">
      <Row :label="t('merge.exportPassword')" required>
        <div class="pwd-with-hint">
          <PasswordField
            :modelValue="form.exportPassword"
            match-file
            file-mode="save"
            @update:modelValue="(v: string) => (form.exportPassword = v)"
          />
          <div
            v-if="form.exportPassword.length > 0 && form.exportPassword.length < EXPORT_PASSWORD_MIN_LENGTH"
            class="pwd-hint"
          >
            {{ t("merge.exportPasswordMinHint", { min: EXPORT_PASSWORD_MIN_LENGTH }) }}
          </div>
        </div>
      </Row>
      <Row :label="t('merge.algorithm')">
        <select
          class="select algorithm-select"
          :value="form.algorithm"
          @change="(e) => (form.algorithm = (e.target as HTMLSelectElement).value as Pkcs12Algorithm)"
        >
          <option v-for="opt in algorithmOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </Row>
      <Row :label="t('merge.outputFile')" required>
        <FileField
          :modelValue="form.outputFile"
          save-mode
          @update:modelValue="(v: string) => (form.outputFile = v)"
          @browse="pickOutput"
        />
      </Row>
      <template #foot>
        <button type="button" class="btn primary" :disabled="!canPrecheck" @click="runPrecheck">
          {{ state === "prechecking" ? t("common.loading") : t("merge.precheckButton") }}
        </button>
        <button type="button" class="btn" :disabled="!canRollback || busy" @click="reset">
          {{ t("common.rollback") }}
        </button>
        <span v-if="inlineStatus" class="inline-status" :class="state">{{ inlineStatus }}</span>
        <span class="spacer-flex" />
        <button
          type="button"
          class="btn ghost"
          :disabled="!canHandoffJks"
          @click="handoffToJks"
        >
          {{ t("merge.toJksButton") }}
        </button>
      </template>
    </Card>

    <WarningDialog
      :warnings="warnings"
      :visible="warningVisible"
      @confirm="onWarningsConfirm"
      @cancel="onWarningsCancel"
    />

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
.pwd-with-hint { display: flex; flex-direction: column; gap: 4px; }
.pwd-hint { font-size: 12px; color: var(--err-ink); }
</style>
