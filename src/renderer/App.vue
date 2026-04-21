<script setup lang="ts">
import { useI18n } from "vue-i18n";
import MergePage from "./pages/MergePage.vue";
import ExtractPage from "./pages/ExtractPage.vue";
import ViewPage from "./pages/ViewPage.vue";
import JksToP12Page from "./pages/JksToP12Page.vue";
import P12ToJksPage from "./pages/P12ToJksPage.vue";
import Icon, { type IconName } from "./components/Icon.vue";
import LanguageSelect from "./components/LanguageSelect.vue";
import { useHandoff, type TabId } from "./stores/handoff";
import pkg from "../../package.json";

const { t } = useI18n();
const appVersion = `v${pkg.version}`;
const { activeTab, setActiveTab } = useHandoff();

type NavItem = { id: TabId; icon: IconName };
const ops: NavItem[] = [
  { id: "merge", icon: "merge" },
  { id: "extract", icon: "extract" },
  { id: "view", icon: "view" }
];
const convert: NavItem[] = [
  { id: "jksToP12", icon: "swap" },
  { id: "jksFromP12", icon: "swap" }
];

function onQuit() {
  if (window.electronAPI?.quitApp) {
    window.electronAPI.quitApp();
  } else {
    window.close();
  }
}
</script>

<template>
  <div class="app">
    <aside class="side">
      <div class="brand">
        <div class="brand-mark">{{ t("app.brandMark") }}</div>
        <div class="brand-text">
          <div class="t">{{ t("app.title") }}</div>
          <div class="s">{{ t("app.subtitle") }}</div>
        </div>
      </div>

      <div class="group-label">{{ t("nav.groupOps") }}</div>
      <button
        v-for="item in ops"
        :key="item.id"
        type="button"
        class="side-tab"
        :class="{ active: activeTab === item.id }"
        @click="setActiveTab(item.id)"
      >
        <span class="ico"><Icon :name="item.icon" :size="16" /></span>
        {{ t(`nav.${item.id}`) }}
      </button>

      <div class="group-label">{{ t("nav.groupConvert") }}</div>
      <button
        v-for="item in convert"
        :key="item.id"
        type="button"
        class="side-tab"
        :class="{ active: activeTab === item.id }"
        @click="setActiveTab(item.id)"
      >
        <span class="ico"><Icon :name="item.icon" :size="16" /></span>
        {{ t(`nav.${item.id}`) }}
      </button>

      <div class="spacer" />

      <div class="lang-block">
        <div class="group-label lang-label">{{ t("nav.language") }}</div>
        <LanguageSelect />
      </div>

      <button
        type="button"
        class="side-tab quit"
        :title="t('nav.quitTitle')"
        @click="onQuit"
      >
        <span class="ico"><Icon name="power" :size="16" /></span>
        {{ t("nav.quit") }}
      </button>

      <div class="version">{{ t("app.version", { version: appVersion }) }}</div>
    </aside>

    <main class="main">
      <KeepAlive>
        <MergePage v-if="activeTab === 'merge'" />
        <ExtractPage v-else-if="activeTab === 'extract'" />
        <ViewPage v-else-if="activeTab === 'view'" />
        <JksToP12Page v-else-if="activeTab === 'jksToP12'" />
        <P12ToJksPage v-else />
      </KeepAlive>
    </main>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: grid;
  grid-template-columns: 220px 1fr;
  grid-template-rows: 100%;
}

/* ----- Sidebar ----- */
.side {
  background: #0f172a;
  color: #e2e8f0;
  padding: 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}
.brand {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 2px 6px 14px;
  border-bottom: 1px solid #1e293b;
  margin-bottom: 10px;
}
.brand-mark {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: var(--accent);
  display: grid;
  place-items: center;
  color: white;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: -0.02em;
}
.brand-text { line-height: 1.15; min-width: 0; }
.brand-text .t {
  font-weight: 600;
  font-size: 13px;
  color: #f1f5f9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.brand-text .s {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 1px;
}

.side-tab {
  display: flex;
  align-items: center;
  gap: 10px;
  background: transparent;
  border: none;
  color: #cbd5e1;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  font-weight: 500;
}
.side-tab .ico {
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  color: #94a3b8;
  flex: 0 0 18px;
}
.side-tab:hover { background: #1e293b; color: #f1f5f9; }
.side-tab.active { background: #1e293b; color: #fff; }
.side-tab.active .ico { color: var(--accent); }
.side-tab.quit { margin-top: 4px; }
.side-tab.quit:hover {
  background: oklch(0.28 0.08 25);
  color: oklch(0.82 0.15 25);
}
.side-tab.quit:hover .ico { color: oklch(0.75 0.17 25); }

.group-label {
  text-transform: uppercase;
  letter-spacing: .08em;
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
  padding: 12px 10px 6px;
}
.spacer { flex: 1; }
.lang-block { padding: 8px 10px 4px; }
.lang-label { padding: 0 0 6px; }
.version {
  font-size: 11px;
  color: #64748b;
  padding: 8px 8px 2px;
}

/* ----- Main ----- */
.main {
  overflow: auto;
  padding: 18px 22px 24px;
}
</style>
