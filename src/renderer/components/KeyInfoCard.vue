<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PrivateKeyInfo } from "../../types";

defineProps<{ keyInfo: PrivateKeyInfo }>();
const { t } = useI18n();
</script>

<template>
  <div class="card">
    <div class="row">
      <span class="badge">{{ keyInfo.algorithm }}</span>
      <span class="bits">{{ keyInfo.keySize }} {{ t("key.keySize") }}</span>
      <span class="enc" :class="keyInfo.encrypted ? 'yes' : 'no'">
        {{ keyInfo.encrypted ? t("key.encryptedYes") : t("key.encryptedNo") }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.card {
  padding: 14px 16px; border-radius: 10px;
  border: 1px solid #e2e8f0; background: #f8fafc;
}
.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.badge {
  padding: 4px 10px; background: #2563eb; color: white;
  border-radius: 6px; font-weight: 600; font-size: 0.85rem;
}
.bits { color: #334155; font-family: Consolas, monospace; font-size: 0.9rem; }
.enc {
  padding: 3px 9px; border-radius: 10px; font-size: 0.78rem; font-weight: 600;
}
.enc.yes { background: #fef3c7; color: #92400e; }
.enc.no { background: #dcfce7; color: #166534; }
</style>
