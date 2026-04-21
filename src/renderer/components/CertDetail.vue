<script setup lang="ts">
import { useI18n } from "vue-i18n";
import Row from "./Row.vue";
import type { CertificateInfo } from "../../types";

defineProps<{ cert: CertificateInfo }>();

const { t } = useI18n();
</script>

<template>
  <div class="cert-detail">
    <Row :label="t('cert.subject')" stack>
      <span class="mono">{{ cert.subject || t("cert.empty") }}</span>
    </Row>
    <Row :label="t('cert.issuer')" stack>
      <span class="mono">{{ cert.issuer || t("cert.empty") }}</span>
    </Row>
    <Row :label="t('cert.serialNumber')" stack>
      <span class="mono">{{ cert.serialNumber || t("cert.empty") }}</span>
    </Row>
    <Row :label="t('cert.notBefore')" stack>
      <span>{{ cert.notBefore || t("cert.empty") }}</span>
    </Row>
    <Row :label="t('cert.notAfter')" stack>
      <span>{{ cert.notAfter || t("cert.empty") }}</span>
    </Row>
    <Row :label="t('cert.signatureAlgorithm')" stack>
      <span>{{ cert.signatureAlgorithm || t("cert.empty") }}</span>
    </Row>
    <Row :label="t('cert.subjectAltNames')" stack>
      <ul v-if="cert.subjectAltNames.length" class="san">
        <li v-for="s in cert.subjectAltNames" :key="s" class="mono">{{ s }}</li>
      </ul>
      <span v-else class="muted">{{ t("cert.empty") }}</span>
    </Row>
    <Row :label="t('cert.subjectKeyIdentifier')" stack>
      <span class="mono">{{ cert.subjectKeyIdentifier || t("cert.empty") }}</span>
    </Row>
    <Row :label="t('cert.authorityKeyIdentifier')" stack>
      <span class="mono">{{ cert.authorityKeyIdentifier || t("cert.empty") }}</span>
    </Row>
    <Row :label="t('cert.fingerprintSha1')" stack>
      <span class="mono">{{ cert.fingerprint.sha1 || t("cert.empty") }}</span>
    </Row>
    <Row :label="t('cert.fingerprintSha256')" stack>
      <span class="mono">{{ cert.fingerprint.sha256 || t("cert.empty") }}</span>
    </Row>
    <Row :label="t('cert.publicKeySha256')" stack>
      <span class="mono">{{ cert.publicKeySha256 || t("cert.empty") }}</span>
    </Row>
  </div>
</template>

<style scoped>
.cert-detail .mono {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
  word-break: break-all;
}
.san {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.muted {
  color: var(--muted-2);
  font-style: italic;
  font-size: 12px;
}
</style>
