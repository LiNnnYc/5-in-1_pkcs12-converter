<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import FileSelector from "../components/FileSelector.vue";
import PasswordInput from "../components/PasswordInput.vue";
import ResultDisplay from "../components/ResultDisplay.vue";
import CertificateCard from "../components/CertificateCard.vue";
import KeyInfoCard from "../components/KeyInfoCard.vue";
import type { OperationResult, Pkcs12ViewResult } from "../../types";

const { t } = useI18n();

const form = reactive({
  pfxFile: "",
  pfxPassword: ""
});

const busy = ref(false);
const result = ref<OperationResult<Pkcs12ViewResult> | null>(null);

const pfxFilters = [
  { name: t("dialog.filters.pfx"), extensions: ["pfx", "p12"] },
  { name: t("dialog.filters.all"), extensions: ["*"] }
];

const canRun = computed(
  () => form.pfxFile.length > 0 && form.pfxPassword.length > 0 && !busy.value
);

const view = computed<Pkcs12ViewResult | null>(() => {
  if (result.value?.success && result.value.details) return result.value.details;
  return null;
});

async function run() {
  if (busy.value) return;
  result.value = null;
  busy.value = true;
  try {
    const res = await window.electronAPI.viewPkcs12({
      pfxFile: form.pfxFile,
      pfxPassword: form.pfxPassword
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
    <h2>{{ t("view.pageTitle") }}</h2>

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
    </div>

    <div class="actions">
      <button type="button" class="btn primary" :disabled="!canRun" @click="run">
        {{ busy ? t("common.loading") : t("view.viewButton") }}
      </button>
    </div>

    <ResultDisplay v-if="result && !result.success" :result="result" />

    <div v-if="view" class="view">
      <section class="block">
        <h3>{{ t("view.sections.privateKey") }}</h3>
        <KeyInfoCard v-if="view.privateKey" :key-info="view.privateKey" />
        <p v-else class="empty">{{ t("view.sections.noPrivateKey") }}</p>
      </section>

      <section v-if="view.serverCert" class="block">
        <h3>{{ t("view.sections.serverCert") }}</h3>
        <CertificateCard :cert="view.serverCert" :title="t('view.sections.serverCert')" />
      </section>

      <section class="block">
        <h3>{{ t("view.sections.chainCerts") }}</h3>
        <div v-if="view.chainCerts.length" class="chain-list">
          <CertificateCard
            v-for="(c, i) in view.chainCerts"
            :key="i"
            :cert="c"
            :title="`#${i + 1} · ${c.subject}`"
            :default-open="false"
            collapsible
          />
        </div>
        <p v-else class="empty">{{ t("view.sections.noChain") }}</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
h2 { margin: 0; font-size: 1.25rem; color: #0f172a; }
h3 { margin: 0 0 10px; font-size: 1rem; color: #1e293b; }
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
.view { display: flex; flex-direction: column; gap: 18px; margin-top: 8px; }
.block { display: flex; flex-direction: column; }
.chain-list { display: flex; flex-direction: column; gap: 10px; }
.empty { margin: 0; color: #94a3b8; font-size: 0.9rem; }
</style>
