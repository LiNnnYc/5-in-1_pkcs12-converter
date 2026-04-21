<script setup lang="ts">
import { computed, onActivated, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Card from "../components/Card.vue";
import Row from "../components/Row.vue";
import FileField from "../components/FileField.vue";
import PasswordField from "../components/PasswordField.vue";
import AliasPicker from "../components/AliasPicker.vue";
import ResultDisplay from "../components/ResultDisplay.vue";
import Icon from "../components/Icon.vue";
import { useHandoff } from "../stores/handoff";
import type { OperationResult } from "../../types";

const { t } = useI18n();
const { consume } = useHandoff();

type State = "idle" | "listing" | "picking" | "converting" | "success" | "error";

const form = reactive({
  pfxFile: "",
  pfxPassword: "",
  outputPassword: "",
  outputFile: "",
  alias: ""
});

const state = ref<State>("idle");
const aliases = ref<string[]>([]);
const result = ref<OperationResult | null>(null);

watch([() => form.pfxFile, () => form.pfxPassword], () => {
  if (state.value === "picking" || state.value === "error" || state.value === "success") {
    aliases.value = [];
    form.alias = "";
    result.value = null;
    state.value = "idle";
  }
});

onActivated(() => {
  const payload = consume("jksFromP12");
  if (payload) {
    form.pfxFile = payload.pfxFile;
    form.pfxPassword = payload.pfxPassword;
  }
});

const pfxFilters = [
  { name: t("dialog.filters.pfx"), extensions: ["pfx", "p12"] },
  { name: t("dialog.filters.all"), extensions: ["*"] }
];
const jksFilters = [
  { name: t("dialog.filters.jks"), extensions: ["jks", "keystore"] },
  { name: t("dialog.filters.all"), extensions: ["*"] }
];

const busy = computed(() => state.value === "listing" || state.value === "converting");

const canRollback = computed(() => state.value !== "idle");

const canConvert = computed(
  () =>
    form.pfxFile.length > 0 &&
    form.pfxPassword.length > 0 &&
    form.outputPassword.length > 0 &&
    form.outputFile.length > 0 &&
    !busy.value &&
    (state.value !== "picking" || form.alias.length > 0)
);

const inlineStatus = computed(() => {
  switch (state.value) {
    case "listing": return t("p12ToJks.statusListing");
    case "converting": return t("p12ToJks.statusConverting");
    case "success": return t("p12ToJks.statusSuccess");
    case "error": return t("p12ToJks.statusError");
    default: return "";
  }
});

async function pickPfx() {
  const picked = await window.electronAPI.openFileDialog({
    filters: pfxFilters,
    title: t("dialog.selectPfx")
  });
  if (picked && picked[0]) form.pfxFile = picked[0];
}

async function pickOutput() {
  const picked = await window.electronAPI.saveFileDialog({
    filters: jksFilters,
    defaultName: "output.jks",
    title: t("dialog.selectOutput")
  });
  if (picked) form.outputFile = picked;
}

async function doConvert() {
  state.value = "converting";
  try {
    const res = await window.electronAPI.p12ToJks({
      pfxFile: form.pfxFile,
      pfxPassword: form.pfxPassword,
      outputFile: form.outputFile,
      outputPassword: form.outputPassword,
      aliasFilter: form.alias || undefined
    });
    result.value = res;
    state.value = res.success ? "success" : "error";
  } catch {
    result.value = { success: false, message: "error.internalError" };
    state.value = "error";
  }
}

async function convert() {
  if (busy.value) return;
  if (state.value === "picking" && form.alias) {
    await doConvert();
    return;
  }
  result.value = null;
  aliases.value = [];
  form.alias = "";
  state.value = "listing";
  try {
    const res = await window.electronAPI.listKeystoreAliases({
      keystoreFile: form.pfxFile,
      keystorePassword: form.pfxPassword,
      storeType: "PKCS12"
    });
    if (!res.success || !res.details) {
      result.value = res;
      state.value = "error";
      return;
    }
    aliases.value = (res.details.aliases ?? []).map((a) => a.alias);
    if (aliases.value.length === 0) {
      result.value = { success: false, message: "error.keystoreEmpty" };
      state.value = "error";
      return;
    }
    if (aliases.value.length === 1) {
      form.alias = aliases.value[0];
      await doConvert();
    } else {
      state.value = "picking";
    }
  } catch {
    result.value = { success: false, message: "error.internalError" };
    state.value = "error";
  }
}

function reset() {
  state.value = "idle";
  aliases.value = [];
  form.alias = "";
  result.value = null;
}

function resetAll() {
  form.pfxFile = "";
  form.pfxPassword = "";
  form.outputPassword = "";
  form.outputFile = "";
  reset();
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="head-main">
        <h1>{{ t("p12ToJks.pageTitle") }}</h1>
        <div class="crumb">{{ t("p12ToJks.crumb") }}</div>
      </div>
      <button type="button" class="btn btn-reset" :title="t('common.reset')" @click="resetAll">
        <Icon name="refresh" :size="14" />
        {{ t("common.reset") }}
      </button>
    </header>

    <Card :title="t('common.source')">
      <Row :label="t('p12ToJks.pfxFile')" required>
        <FileField
          :modelValue="form.pfxFile"
          @update:modelValue="(v: string) => (form.pfxFile = v)"
          @browse="pickPfx"
        />
      </Row>
      <Row :label="t('p12ToJks.pfxPassword')" required>
        <PasswordField
          :modelValue="form.pfxPassword"
          match-file
          @update:modelValue="(v: string) => (form.pfxPassword = v)"
        />
      </Row>
      <template #foot>
        <span
          v-if="inlineStatus"
          class="inline-status"
          :class="state"
        >{{ inlineStatus }}</span>
        <span class="spacer-flex" />
      </template>
    </Card>

    <Card :title="t('common.output')">
      <Row :label="t('p12ToJks.outputPassword')" required>
        <PasswordField
          :modelValue="form.outputPassword"
          match-file
          file-mode="save"
          @update:modelValue="(v: string) => (form.outputPassword = v)"
        />
      </Row>
      <Row :label="t('p12ToJks.outputFile')" required>
        <FileField
          :modelValue="form.outputFile"
          save-mode
          @update:modelValue="(v: string) => (form.outputFile = v)"
          @browse="pickOutput"
        />
      </Row>
      <template #foot>
        <button
          type="button"
          class="btn primary"
          :disabled="!canConvert"
          @click="convert"
        >
          {{ busy
            ? t("common.loading")
            : state === "picking"
              ? t("common.continue")
              : t("p12ToJks.convertButton") }}
        </button>
        <button type="button" class="btn" :disabled="!canRollback || busy" @click="reset">
          {{ t("common.rollback") }}
        </button>
        <span class="spacer-flex" />
        <span class="dest-notice">
          <Icon name="info" :size="14" />
          {{ t("p12ToJks.destAliasNotice") }}
        </span>
      </template>
    </Card>

    <AliasPicker
      v-if="state === 'picking' || (state === 'converting' && aliases.length > 0)"
      v-model="form.alias"
      :aliases="aliases"
      :disabled="state === 'converting'"
      label-scope="p12ToJks"
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
.dest-notice {
  font-size: 12px;
  color: var(--info-ink);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.page :deep(.picker) { margin-top: 12px; }
</style>
