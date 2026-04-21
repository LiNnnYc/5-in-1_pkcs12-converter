<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { locale } = useI18n();

const value = computed({
  get: () => locale.value,
  set: (v: string) => { locale.value = v as typeof locale.value; }
});
</script>

<template>
  <select class="lang-select" v-model="value" :aria-label="$t('nav.language')">
    <option value="zh-TW">繁體中文</option>
    <option value="en">English</option>
    <option value="ja" disabled>日本語（即將推出）</option>
  </select>
</template>

<style scoped>
.lang-select {
  width: 100%;
  padding: 6px 26px 6px 10px;
  border-radius: 6px;
  border: 1px solid #1e293b;
  background: #1e293b url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='%2394a3b8' d='M0 0l5 6 5-6z'/></svg>") no-repeat right 8px center;
  color: #cbd5e1;
  font-size: 12.5px;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}
.lang-select:focus { outline: 2px solid var(--accent-soft); }
</style>
