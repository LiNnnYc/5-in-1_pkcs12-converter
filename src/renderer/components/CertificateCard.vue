<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { CertificateInfo } from "../../types";

const props = defineProps<{
  cert: CertificateInfo;
  title?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
}>();

const { t } = useI18n();
const open = ref(props.defaultOpen ?? true);

function toggle() {
  if (props.collapsible !== false) open.value = !open.value;
}
</script>

<template>
  <div class="card">
    <header class="head" :class="{ clickable: collapsible !== false }" @click="toggle">
      <h4>{{ title || cert.subject }}</h4>
      <span v-if="collapsible !== false" class="caret">{{ open ? "▾" : "▸" }}</span>
    </header>

    <dl v-show="open" class="fields">
      <dt>{{ t("cert.subject") }}</dt>
      <dd class="mono">{{ cert.subject }}</dd>

      <dt>{{ t("cert.issuer") }}</dt>
      <dd class="mono">{{ cert.issuer }}</dd>

      <dt>{{ t("cert.serialNumber") }}</dt>
      <dd class="mono">{{ cert.serialNumber || t("cert.empty") }}</dd>

      <dt>{{ t("cert.notBefore") }}</dt>
      <dd>{{ cert.notBefore }}</dd>

      <dt>{{ t("cert.notAfter") }}</dt>
      <dd>{{ cert.notAfter }}</dd>

      <dt>{{ t("cert.signatureAlgorithm") }}</dt>
      <dd>{{ cert.signatureAlgorithm || t("cert.empty") }}</dd>

      <dt>{{ t("cert.subjectAltNames") }}</dt>
      <dd>
        <ul v-if="cert.subjectAltNames.length" class="san">
          <li v-for="s in cert.subjectAltNames" :key="s" class="mono">{{ s }}</li>
        </ul>
        <span v-else class="empty">{{ t("cert.empty") }}</span>
      </dd>

      <dt>{{ t("cert.subjectKeyIdentifier") }}</dt>
      <dd class="mono">{{ cert.subjectKeyIdentifier || t("cert.empty") }}</dd>

      <dt>{{ t("cert.authorityKeyIdentifier") }}</dt>
      <dd class="mono">{{ cert.authorityKeyIdentifier || t("cert.empty") }}</dd>

      <dt>{{ t("cert.fingerprintSha1") }}</dt>
      <dd class="mono">{{ cert.fingerprint.sha1 || t("cert.empty") }}</dd>

      <dt>{{ t("cert.fingerprintSha256") }}</dt>
      <dd class="mono">{{ cert.fingerprint.sha256 || t("cert.empty") }}</dd>
    </dl>
  </div>
</template>

<style scoped>
.card {
  border: 1px solid #e2e8f0; border-radius: 10px;
  background: white; overflow: hidden;
}
.head {
  padding: 10px 16px; background: #f1f5f9;
  display: flex; justify-content: space-between; align-items: center;
  border-bottom: 1px solid #e2e8f0;
}
.head.clickable { cursor: pointer; user-select: none; }
.head.clickable:hover { background: #e2e8f0; }
h4 { margin: 0; font-size: 0.95rem; color: #0f172a; font-weight: 600; word-break: break-all; }
.caret { color: #64748b; font-size: 0.85rem; margin-left: 8px; }
.fields {
  display: grid; grid-template-columns: 180px 1fr;
  gap: 6px 14px; margin: 0; padding: 14px 16px;
  font-size: 0.88rem;
}
dt { font-weight: 600; color: #475569; }
dd { margin: 0; color: #0f172a; word-break: break-all; }
.mono { font-family: Consolas, monospace; font-size: 0.85rem; }
.san { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.empty { color: #94a3b8; }
</style>
