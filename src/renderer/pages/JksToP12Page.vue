<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Card from "../components/Card.vue";
import Row from "../components/Row.vue";
import FileField from "../components/FileField.vue";
import PasswordField from "../components/PasswordField.vue";
import AliasPicker from "../components/AliasPicker.vue";
import ResultDisplay from "../components/ResultDisplay.vue";
import Icon from "../components/Icon.vue";
import type { AliasEntry, OperationResult } from "../../types";

const { t } = useI18n();

type State = "idle" | "listing" | "picking" | "converting" | "success" | "error";

const form = reactive({
  jksFile: "",
  jksPassword: "",
  outputPassword: "",
  outputFile: "",
  alias: ""
});

const state = ref<State>("idle");
const allEntries = ref<AliasEntry[]>([]);
const aliases = ref<string[]>([]);
const result = ref<OperationResult | null>(null);

// Skipped = entries we discarded from the picker because they are not
// exportable to PFX/P12 (trusted-cert-only entries have no private key).
// Kept for an inline notice so users aren't left wondering where they went.
const skippedCount = computed(
  () => allEntries.value.length - aliases.value.length
);

watch([() => form.jksFile, () => form.jksPassword], () => {
  if (state.value === "picking" || state.value === "error" || state.value === "success") {
    allEntries.value = [];
    aliases.value = [];
    form.alias = "";
    result.value = null;
    state.value = "idle";
  }
});

const jksFilters = [
  { name: t("dialog.filters.jks"), extensions: ["jks", "keystore"] },
  { name: t("dialog.filters.all"), extensions: ["*"] }
];
const pfxFilters = [
  { name: t("dialog.filters.pfx"), extensions: ["pfx", "p12"] },
  { name: t("dialog.filters.all"), extensions: ["*"] }
];

const busy = computed(() => state.value === "listing" || state.value === "converting");

// Primary output-card button: kicks off the alias probe or (single-alias
// keystores) runs the conversion directly. Locked while the picker is open so
// the user must commit via the picker's own 下一步 button.
const canConvert = computed(
  () =>
    form.jksFile.length > 0 &&
    form.jksPassword.length > 0 &&
    form.outputPassword.length > 0 &&
    form.outputFile.length > 0 &&
    !busy.value &&
    state.value !== "picking"
);

// Picker-card button: only valid once the user has chosen one of the
// PrivateKeyEntry aliases.
const canProceedFromPicker = computed(
  () => state.value === "picking" && form.alias.length > 0 && !busy.value
);

const canRollback = computed(() => state.value !== "idle");

const inlineStatus = computed(() => {
  switch (state.value) {
    case "listing": return t("jksToP12.statusListing");
    case "converting": return t("jksToP12.statusConverting");
    case "success": return t("jksToP12.statusSuccess");
    case "error": return t("jksToP12.statusError");
    default: return "";
  }
});

async function pickJks() {
  const picked = await window.electronAPI.openFileDialog({
    filters: jksFilters,
    title: t("dialog.selectJks")
  });
  if (picked && picked[0]) form.jksFile = picked[0];
}

async function pickOutput() {
  const picked = await window.electronAPI.saveFileDialog({
    filters: pfxFilters,
    defaultName: "output.pfx",
    title: t("dialog.selectOutput")
  });
  if (picked) form.outputFile = picked;
}

async function doConvert() {
  state.value = "converting";
  try {
    const res = await window.electronAPI.jksToP12({
      jksFile: form.jksFile,
      jksPassword: form.jksPassword,
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
  if (busy.value || state.value === "picking") return;
  result.value = null;
  allEntries.value = [];
  aliases.value = [];
  form.alias = "";
  state.value = "listing";
  try {
    const res = await window.electronAPI.listKeystoreAliases({
      keystoreFile: form.jksFile,
      keystorePassword: form.jksPassword,
      storeType: "JKS"
    });
    if (!res.success || !res.details) {
      result.value = res;
      state.value = "error";
      return;
    }
    allEntries.value = [...(res.details.aliases ?? [])];
    // Only PrivateKeyEntry aliases are meaningful for PFX/P12 output — a
    // TrustedCertEntry has no private key, so converting it would produce a
    // keystore with no usable credential.
    const exportable = allEntries.value.filter((e) => e.entryType === "PrivateKeyEntry");
    aliases.value = exportable.map((e) => e.alias);
    if (aliases.value.length === 0) {
      result.value = { success: false, message: "error.noExportableAlias" };
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

async function proceedFromPicker() {
  if (!canProceedFromPicker.value) return;
  await doConvert();
}

function reset() {
  state.value = "idle";
  allEntries.value = [];
  aliases.value = [];
  form.alias = "";
  result.value = null;
}

function resetAll() {
  form.jksFile = "";
  form.jksPassword = "";
  form.outputPassword = "";
  form.outputFile = "";
  reset();
}

</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="head-main">
        <h1>{{ t("jksToP12.pageTitle") }}</h1>
        <div class="crumb">{{ t("jksToP12.crumb") }}</div>
      </div>
      <button type="button" class="btn btn-reset" :title="t('common.reset')" @click="resetAll">
        <Icon name="refresh" :size="14" />
        {{ t("common.reset") }}
      </button>
    </header>

    <Card :title="t('common.source')">
      <Row :label="t('jksToP12.jksFile')" required>
        <FileField
          :modelValue="form.jksFile"
          @update:modelValue="(v: string) => (form.jksFile = v)"
          @browse="pickJks"
        />
      </Row>
      <Row :label="t('jksToP12.jksPassword')" required>
        <PasswordField
          :modelValue="form.jksPassword"
          match-file
          @update:modelValue="(v: string) => (form.jksPassword = v)"
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
      <Row :label="t('jksToP12.outputPassword')" required>
        <PasswordField
          :modelValue="form.outputPassword"
          match-file
          file-mode="save"
          @update:modelValue="(v: string) => (form.outputPassword = v)"
        />
      </Row>
      <Row :label="t('jksToP12.outputFile')" required>
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
          {{ busy ? t("common.loading") : t("jksToP12.convertButton") }}
        </button>
        <button type="button" class="btn" :disabled="!canRollback || busy" @click="reset">
          {{ t("common.rollback") }}
        </button>
        <span class="spacer-flex" />
      </template>
    </Card>

    <Card
      v-if="state === 'picking' || (state === 'converting' && aliases.length > 0)"
      :title="t('jksToP12.aliasPickerTitle')"
    >
      <AliasPicker
        v-model="form.alias"
        :aliases="aliases"
        :disabled="state === 'converting'"
      />
      <p v-if="skippedCount > 0" class="skip-notice">
        {{ t("jksToP12.trustedCertSkipped", { count: skippedCount }) }}
      </p>
      <template #foot>
        <button
          type="button"
          class="btn primary"
          :disabled="!canProceedFromPicker"
          @click="proceedFromPicker"
        >
          {{ state === "converting" ? t("common.loading") : t("common.next") }}
        </button>
      </template>
    </Card>

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
.page :deep(.picker) {
  margin: 0;
  background: transparent;
  border: none;
  padding: 12px 14px;
}
.skip-notice {
  margin: 0 14px 10px;
  font-size: 12px;
  color: var(--muted);
  font-style: italic;
}
</style>
