<script setup lang="ts">
import { useI18n } from "vue-i18n";
import MergePage from "./pages/MergePage.vue";
import ExtractPage from "./pages/ExtractPage.vue";
import ViewPage from "./pages/ViewPage.vue";
import JksToP12Page from "./pages/JksToP12Page.vue";
import P12ToJksPage from "./pages/P12ToJksPage.vue";
import { useHandoff, type TabId } from "./stores/handoff";

const { t } = useI18n();
const { activeTab, setActiveTab } = useHandoff();

const tabs: TabId[] = ["merge", "extract", "view", "jksToP12", "jksFromP12"];
</script>

<template>
  <main class="shell">
    <header class="header">
      <div>
        <h1>{{ t("app.title") }}</h1>
        <p class="subtitle">{{ t("app.subtitle") }}</p>
      </div>
    </header>

    <nav class="tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab"
        class="tab"
        :class="{ active: activeTab === tab }"
        @click="setActiveTab(tab)"
      >
        {{ t(`nav.${tab}`) }}
      </button>
    </nav>

    <section class="content">
      <MergePage v-if="activeTab === 'merge'" />
      <ExtractPage v-else-if="activeTab === 'extract'" />
      <ViewPage v-else-if="activeTab === 'view'" />
      <JksToP12Page v-else-if="activeTab === 'jksToP12'" />
      <P12ToJksPage v-else />
    </section>
  </main>
</template>

<style>
html, body, #app { margin: 0; padding: 0; height: 100%; }
body {
  font-family: "Segoe UI", "Noto Sans TC", sans-serif;
  background: #f8fafc; color: #0f172a;
}
</style>

<style scoped>
.shell {
  min-height: 100vh;
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.header h1 { margin: 0; font-size: 1.4rem; color: #0f172a; }
.subtitle { margin: 4px 0 0; color: #64748b; font-size: 0.9rem; }
.tabs {
  display: flex; gap: 4px;
  border-bottom: 1px solid #e2e8f0;
}
.tab {
  padding: 10px 20px; background: none; border: none;
  border-bottom: 2px solid transparent; cursor: pointer;
  font-size: 0.95rem; color: #64748b; font-weight: 500;
}
.tab:hover { color: #334155; }
.tab.active { color: #2563eb; border-bottom-color: #2563eb; font-weight: 600; }
.content {
  background: white; border-radius: 12px; padding: 24px;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
  border: 1px solid #e2e8f0;
}
.placeholder {
  padding: 40px; text-align: center; color: #94a3b8;
}
</style>
