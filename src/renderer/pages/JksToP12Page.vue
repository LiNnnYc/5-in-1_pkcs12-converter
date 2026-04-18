<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import FileSelector from "../components/FileSelector.vue";
import PasswordInput from "../components/PasswordInput.vue";
import AliasPicker from "../components/AliasPicker.vue";
import ResultDisplay from "../components/ResultDisplay.vue";
import { useHandoff } from "../stores/handoff";
import type { OperationResult } from "../../types";

const { t } = useI18n();
const { navigate } = useHandoff();

function handoffToExtract() {
  if (!form.outputFile || !form.outputPassword) return;
  navigate("extract", {
    target: "extract",
    pfxFile: form.outputFile,
    pfxPassword: form.outputPassword
  });
}

type State = "idle" | "listing" | "picking" | "converting" | "success" | "error";

const form = reactive({
  jksFile: "",
  jksPassword: "",
  outputPassword: "",
  outputFile: "",
  alias: ""
});

const state = ref<State>("idle");
const aliases = ref<string[]>([]);
const result = ref<OperationResult | null>(null);

// When the input JKS file or password changes after a list, the cached alias
// list is stale — clear it so the user can't accidentally submit against a
// different keystore.
watch([() => form.jksFile, () => form.jksPassword], () => {
  if (state.value === "picking" || state.value === "error" || state.value === "success") {
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

const canListAliases = computed(
  () => form.jksFile.length > 0 && form.jksPassword.length > 0 && !busy.value
);

const canConvert = computed(
  () =>
    state.value === "picking" &&
    form.alias.length > 0 &&
    form.outputPassword.length > 0 &&
    form.outputFile.length > 0
);

async function listAliases() {
  if (busy.value) return;
  result.value = null;
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
    aliases.value = res.details.aliases ?? [];
    if (aliases.value.length === 0) {
      result.value = { success: false, message: "error.aliasNotFound" };
      state.value = "error";
      return;
    }
    state.value = "picking";
  } catch {
    result.value = { success: false, message: "error.internalError" };
    state.value = "error";
  }
}

async function convert() {
  if (busy.value) return;
  if (state.value !== "picking") return;
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

function reset() {
  state.value = "idle";
  aliases.value = [];
  form.alias = "";
  result.value = null;
}
</script>

<template>
  <section class="page">
    <h2>{{ t("jksToP12.pageTitle") }}</h2>

    <div class="grid">
      <FileSelector
        v-model="form.jksFile"
        :label="t('jksToP12.jksFile')"
        :filters="jksFilters"
        :title="t('dialog.selectJks')"
        :disabled="busy"
      />
      <PasswordInput
        v-model="form.jksPassword"
        :label="t('jksToP12.jksPassword')"
        :disabled="busy"
      />
      <PasswordInput
        v-model="form.outputPassword"
        :label="t('jksToP12.outputPassword')"
        :disabled="busy"
      />
      <FileSelector
        v-model="form.outputFile"
        :label="t('jksToP12.outputFile')"
        :filters="pfxFilters"
        :title="t('dialog.selectOutput')"
        mode="save"
        defaultName="output.p12"
        :disabled="busy"
      />
    </div>

    <div class="actions">
      <button
        type="button"
        class="btn primary"
        :disabled="!canListAliases || state === 'picking'"
        @click="listAliases"
      >
        {{ state === "listing" ? t("common.loading") : t("jksToP12.listAliasesButton") }}
      </button>
      <button
        type="button"
        class="btn primary"
        :disabled="!canConvert"
        @click="convert"
      >
        {{ state === "converting" ? t("common.loading") : t("jksToP12.convertButton") }}
      </button>
      <button type="button" class="btn" :disabled="busy" @click="reset">
        {{ t("common.cancel") }}
      </button>
    </div>

    <AliasPicker
      v-if="state === 'picking' || (state === 'converting' && aliases.length > 0)"
      v-model="form.alias"
      :aliases="aliases"
      :disabled="state === 'converting'"
    />

    <ResultDisplay :result="result">
      <div v-if="result && result.success" class="followup">
        <button type="button" class="btn" @click="handoffToExtract">
          {{ t("jksToP12.toExtractButton") }}
        </button>
      </div>
    </ResultDisplay>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
h2 { margin: 0; font-size: 1.25rem; color: #0f172a; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
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
