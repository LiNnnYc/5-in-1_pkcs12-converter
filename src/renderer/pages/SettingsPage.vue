<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import Card from "../components/Card.vue";
import Row from "../components/Row.vue";
import LanguageSelect from "../components/LanguageSelect.vue";
import type { AppSettings, EngineInfo, RuntimeInfo } from "../global";
import pkg from "../../../package.json";

const { t } = useI18n();

type LogLevel = AppSettings["logging"]["level"];
const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

const loaded = ref(false);
const logEnabled = ref(false);
const logLevel = ref<LogLevel>("info");
const engine = ref<EngineInfo | null>(null);
const runtime = ref<RuntimeInfo | null>(null);
const fallbackVersion = `v${pkg.version}`;

onMounted(async () => {
  const [settings, info, rt] = await Promise.all([
    window.electronAPI.getSettings(),
    window.electronAPI.getEngineInfo(),
    window.electronAPI.getRuntimeInfo()
  ]);
  logEnabled.value = settings.logging.enabled;
  logLevel.value = settings.logging.level;
  engine.value = info;
  runtime.value = rt;
  loaded.value = true;
});

// Level dropdown is disabled when log is toggled off (visual cue replaces hint).
const levelDisabled = computed(() => !loaded.value || !logEnabled.value);
// Level changes apply live IFF logging was already running at app start.
// When user just turned the toggle on, logging hasn't actually started yet
// (waits for restart), so we surface the same restart hint there too.
const showLevelRestartHint = computed(
  () => logEnabled.value && !(runtime.value?.loggingEnabled ?? false)
);
// Enable row's restart hint surfaces only when the toggle differs from what
// the logger was configured with at startup — i.e. user has a pending change.
const showEnabledRestartHint = computed(
  () => loaded.value && logEnabled.value !== (runtime.value?.loggingEnabled ?? false)
);

async function persistLogging() {
  await window.electronAPI.setSettings({
    logging: { enabled: logEnabled.value, level: logLevel.value }
  });
}

async function onToggleLog(e: Event) {
  logEnabled.value = (e.target as HTMLInputElement).checked;
  await persistLogging();
}

async function onChangeLevel(e: Event) {
  logLevel.value = (e.target as HTMLSelectElement).value as LogLevel;
  await persistLogging();
}

async function openLogsDir() {
  if (runtime.value?.logsDir) {
    await window.electronAPI.revealPath(runtime.value.logsDir);
  }
}

async function openWorkDir() {
  // Use the dedicated handler so main process mkdir's the lazy .work/ folder
  // before opening — otherwise users hitting this before any operation has
  // run get a no-op.
  await window.electronAPI.revealWorkDir();
}
</script>

<template>
  <section class="page settings-page">
    <header class="page-head">
      <div class="head-main">
        <h1>{{ t("settings.pageTitle") }}</h1>
        <div class="crumb">{{ t("settings.crumb") }}</div>
      </div>
    </header>

    <Card :title="t('settings.sections.language')">
      <Row :label="t('nav.language')">
        <div class="lang-wrap">
          <LanguageSelect />
        </div>
      </Row>
    </Card>

    <Card :title="t('settings.sections.logging')">
      <Row
        :label="t('settings.logging.enabled')"
        :hint="showEnabledRestartHint ? t('settings.logging.restartNote') : ''"
      >
        <label class="switch">
          <input
            type="checkbox"
            :checked="logEnabled"
            :disabled="!loaded"
            @change="onToggleLog"
          />
          <span>{{ t("settings.logging.enableInline") }}</span>
        </label>
      </Row>
      <Row
        :label="t('settings.logging.level')"
        :hint="showLevelRestartHint ? t('settings.logging.restartNote') : ''"
      >
        <select
          class="lvl-select"
          :value="logLevel"
          :disabled="levelDisabled"
          @change="onChangeLevel"
        >
          <option v-for="lv in LEVELS" :key="lv" :value="lv">
            {{ t(`settings.logging.levels.${lv}`) }}
          </option>
        </select>
      </Row>
      <Row :label="t('settings.logging.sessionId')">
        <code class="mono">{{ runtime?.sessionId ?? "—" }}</code>
      </Row>
      <Row :label="t('settings.logging.currentFile')">
        <div class="path-line">
          <code class="mono path">{{ runtime?.currentLogFile ?? t("settings.logging.noFile") }}</code>
        </div>
      </Row>
      <Row :label="t('settings.logging.folder')">
        <div class="path-line">
          <code class="mono path">{{ runtime?.logsDir ?? "—" }}</code>
          <button type="button" class="btn-mini" :disabled="!runtime" @click="openLogsDir">
            {{ t("settings.openFolder") }}
          </button>
        </div>
      </Row>
      <Row :label="t('settings.logging.retention')">
        <span class="ro">{{ t("settings.logging.retentionValue") }}</span>
      </Row>
    </Card>

    <Card :title="t('settings.sections.engines')">
      <Row :label="t('settings.engines.openssl')">
        <span class="ro">{{ engine?.openssl.version ?? "…" }}</span>
      </Row>
      <Row :label="t('settings.engines.opensslPath')">
        <code class="mono path">{{ engine?.openssl.path ?? "—" }}</code>
      </Row>
      <Row :label="t('settings.engines.keytool')">
        <span class="ro">{{ engine?.keytool.version ?? "…" }}</span>
      </Row>
      <Row :label="t('settings.engines.keytoolPath')">
        <code class="mono path">{{ engine?.keytool.path ?? "—" }}</code>
      </Row>
      <Row :label="t('settings.engines.dir')">
        <code class="mono path">{{ engine?.enginesDir ?? "—" }}</code>
      </Row>
    </Card>

    <Card :title="t('settings.sections.about')">
      <Row :label="t('settings.about.version')">
        <span class="ro">{{ runtime ? `v${runtime.version}` : fallbackVersion }}</span>
      </Row>
      <Row :label="t('settings.about.workDir')">
        <div class="path-line">
          <code class="mono path">{{ runtime?.workDir ?? "—" }}</code>
          <button type="button" class="btn-mini" :disabled="!runtime" @click="openWorkDir">
            {{ t("settings.openFolder") }}
          </button>
        </div>
      </Row>
      <Row :label="t('settings.about.github')">
        <button type="button" class="btn-mini disabled" disabled :title="t('settings.about.githubDisabledTitle')">
          {{ t("settings.about.githubPlaceholder") }}
        </button>
      </Row>
    </Card>
  </section>
</template>

<style scoped>
.settings-page { gap: 12px; }
.lang-wrap { max-width: 220px; }
.switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}
.switch input { width: 16px; height: 16px; cursor: pointer; }
.lvl-select {
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  width: 100%;
  max-width: 560px;
}
.lvl-select:disabled { opacity: 0.6; }
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #334155;
}
.path {
  background: #f1f5f9;
  padding: 3px 8px;
  border-radius: 4px;
  word-break: break-all;
}
.path-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ro { font-size: 13px; color: #334155; }
.btn-mini {
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  white-space: nowrap;
}
.btn-mini:hover:not(:disabled) { background: #f1f5f9; }
.btn-mini:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-mini.disabled { color: var(--muted); }
</style>
