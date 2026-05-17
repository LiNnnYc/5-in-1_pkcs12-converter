<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Card from "../components/Card.vue";
import Row from "../components/Row.vue";
import FileField from "../components/FileField.vue";
import PasswordField from "../components/PasswordField.vue";
import Badge from "../components/Badge.vue";
import Alert from "../components/Alert.vue";
import CertDetail from "../components/CertDetail.vue";
import Icon from "../components/Icon.vue";
import type {
  InputKind,
  KeyViewResult,
  OperationResult,
  Pkcs12BagKind,
  Pkcs12EncryptionInfo,
  Pkcs12ViewResult
} from "../../types";

const { t } = useI18n();

// `pfxFile` is kept verbatim despite now sometimes holding a .key path:
// renaming it would cascade through templates and is low-value churn (this
// page is not a handoff source/sink). Treat the field as "input file".
const form = reactive({
  pfxFile: "",
  pfxPassword: ""
});

const busy = ref(false);
const detecting = ref(false);
const result = ref<OperationResult<Pkcs12ViewResult> | null>(null);
const keyResult = ref<OperationResult<KeyViewResult> | null>(null);
const inputKind = ref<InputKind | null>(null);
const detectError = ref<string | null>(null);
const openChainIdx = ref<Record<number, boolean>>({});

// Single detection in-flight at a time: a fast user changing files would
// otherwise race results and stamp the wrong kind on the new file.
let detectSeq = 0;

watch(
  () => form.pfxFile,
  async (next, prev) => {
    if (next === prev) return;
    form.pfxPassword = "";
    result.value = null;
    keyResult.value = null;
    openChainIdx.value = {};
    inputKind.value = null;
    detectError.value = null;
    if (!next) {
      detecting.value = false;
      return;
    }
    const seq = ++detectSeq;
    detecting.value = true;
    try {
      const r = await window.electronAPI.detectInputType(next);
      if (seq !== detectSeq) return; // newer pick superseded this one
      inputKind.value = r.kind;
      if (r.kind === "keyEncrypted") detectError.value = "error.encryptedKeyNotSupported";
      else if (r.kind === "unknown") detectError.value = "error.unsupportedFileType";
    } catch {
      if (seq !== detectSeq) return;
      inputKind.value = "unknown";
      detectError.value = "error.unsupportedFileType";
    } finally {
      if (seq === detectSeq) detecting.value = false;
    }
  }
);

// Accept both PFX and standalone keys; users with the same workflow folder
// shouldn't have to switch filter to view a sibling .key.
const inputFilters = [
  { name: t("dialog.filters.pfxOrKey"), extensions: ["pfx", "p12", "key", "pem"] },
  { name: t("dialog.filters.pfx"), extensions: ["pfx", "p12"] },
  { name: t("dialog.filters.key"), extensions: ["key", "pem"] },
  { name: t("dialog.filters.all"), extensions: ["*"] }
];

const canRun = computed(() => {
  if (busy.value || detecting.value || !form.pfxFile) return false;
  if (inputKind.value === "pfx") return form.pfxPassword.length > 0;
  if (inputKind.value === "keyUnencrypted") return true;
  return false;
});

const view = computed<Pkcs12ViewResult | null>(() => {
  if (result.value?.success && result.value.details) return result.value.details;
  return null;
});

const keyView = computed<KeyViewResult | null>(() => {
  if (keyResult.value?.success && keyResult.value.details) return keyResult.value.details;
  return null;
});

const activeOpResult = computed<OperationResult | null>(() =>
  inputKind.value === "keyUnencrypted" ? keyResult.value : result.value
);

const inlineStatus = computed(() => {
  if (busy.value) return t("view.statusViewing");
  const r = activeOpResult.value;
  if (r?.success) return t("view.statusSuccess");
  if (r && !r.success) return t("view.statusError");
  return "";
});

const failMessage = computed(() => {
  const m = activeOpResult.value?.message ?? "";
  if (!m) return "";
  if (m.startsWith("error.") || m.startsWith("common.")) return t(m);
  return m;
});

const detectErrorMessage = computed(() =>
  detectError.value ? t(detectError.value) : ""
);

async function pickInput() {
  const picked = await window.electronAPI.openFileDialog({
    filters: inputFilters,
    title: t("dialog.selectPfxOrKey")
  });
  if (picked && picked[0]) form.pfxFile = picked[0];
}

async function run() {
  if (busy.value || !canRun.value) return;
  result.value = null;
  keyResult.value = null;
  openChainIdx.value = {};
  busy.value = true;
  try {
    if (inputKind.value === "pfx") {
      result.value = await window.electronAPI.viewPkcs12({
        pfxFile: form.pfxFile,
        pfxPassword: form.pfxPassword
      });
    } else if (inputKind.value === "keyUnencrypted") {
      keyResult.value = await window.electronAPI.viewKey({
        keyFile: form.pfxFile
      });
    }
  } catch {
    const fail = { success: false, message: "error.internalError" } as const;
    if (inputKind.value === "keyUnencrypted") keyResult.value = fail;
    else result.value = fail;
  } finally {
    busy.value = false;
  }
}

function toggleChain(i: number) {
  openChainIdx.value = { ...openChainIdx.value, [i]: !openChainIdx.value[i] };
}

function encSummary(e: Pkcs12EncryptionInfo): string {
  const pieces: string[] = [e.scheme];
  const inner: string[] = [];
  if (e.kdf) inner.push(e.kdf);
  if (e.cipher) inner.push(e.cipher);
  if (e.prf) inner.push(`PRF ${e.prf}`);
  if (inner.length) pieces.push(`(${inner.join(" + ")})`);
  if (typeof e.iterationCount === "number") pieces.push(`Iteration ${e.iterationCount}`);
  return pieces.join(", ");
}

function bagKindLabel(kind: Pkcs12BagKind): string {
  if (kind === "key") return t("view.structure.bagKey");
  if (kind === "cert") return t("view.structure.bagCert");
  return t("view.structure.bagOther");
}

const generationKind = computed<"ok" | "warn" | "neutral">(() => {
  const g = view.value?.structure?.generation;
  if (g === "modern") return "ok";
  if (g === "legacy") return "warn";
  return "neutral";
});

const generationLabel = computed(() => {
  const g = view.value?.structure?.generation;
  if (g === "modern") return t("view.structure.generationModern");
  if (g === "legacy") return t("view.structure.generationLegacy");
  if (g === "mixed") return t("view.structure.generationMixed");
  return t("view.structure.generationUnknown");
});

function resetAll() {
  form.pfxFile = "";
  form.pfxPassword = "";
  result.value = null;
  keyResult.value = null;
  inputKind.value = null;
  detectError.value = null;
  openChainIdx.value = {};
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="head-main">
        <h1>{{ t("view.pageTitle") }}</h1>
        <div class="crumb">{{ t("view.crumb") }}</div>
      </div>
      <button type="button" class="btn btn-reset" :title="t('common.reset')" @click="resetAll">
        <Icon name="refresh" :size="14" />
        {{ t("common.reset") }}
      </button>
    </header>

    <Card :title="t('common.source')">
      <Row :label="t('view.inputFile')" required>
        <FileField
          :modelValue="form.pfxFile"
          @update:modelValue="(v: string) => (form.pfxFile = v)"
          @browse="pickInput"
        />
      </Row>
      <Row v-if="inputKind === 'pfx'" :label="t('extract.pfxPassword')" required>
        <PasswordField
          :modelValue="form.pfxPassword"
          match-file
          @update:modelValue="(v: string) => (form.pfxPassword = v)"
        />
      </Row>
      <template #foot>
        <button type="button" class="btn primary" :disabled="!canRun" @click="run">
          {{ busy ? t("common.loading") : t("view.viewButton") }}
        </button>
        <span
          v-if="inlineStatus"
          class="inline-status"
          :class="{ success: activeOpResult?.success, error: activeOpResult && !activeOpResult.success }"
        >{{ inlineStatus }}</span>
        <span v-if="detecting" class="inline-status">{{ t("view.inputHint.detecting") }}</span>
        <span class="spacer-flex" />
      </template>
    </Card>

    <Alert v-if="inputKind === 'keyUnencrypted'" kind="info">
      {{ t("view.inputHint.unencryptedKey") }}
    </Alert>
    <Alert v-else-if="inputKind === 'keyEncrypted'" kind="warn" :title="t('common.failure')">
      {{ detectErrorMessage }}
    </Alert>
    <Alert v-else-if="inputKind === 'unknown'" kind="err" :title="t('common.failure')">
      {{ detectErrorMessage }}
    </Alert>

    <Alert v-if="activeOpResult && !activeOpResult.success" kind="err" :title="t('common.failure')">
      {{ failMessage }}
    </Alert>

    <template v-if="keyView">
      <Card :title="t('view.sections.privateKey')">
        <div class="key-row">
          <Badge kind="ok">{{ keyView.privateKey.algorithm }}</Badge>
          <span class="mono">{{ keyView.privateKey.keySize }} bits</span>
          <Badge :kind="keyView.privateKey.encrypted ? 'warn' : 'neutral'">
            {{ keyView.privateKey.encrypted ? t("key.encryptedYes") : t("key.encryptedNo") }}
          </Badge>
        </div>
        <Row v-if="keyView.privateKey.subjectKeyIdentifier" :label="t('cert.subjectKeyIdentifier')" stack>
          <span class="mono fp">{{ keyView.privateKey.subjectKeyIdentifier }}</span>
        </Row>
      </Card>
    </template>

    <template v-if="view">
      <Card :title="t('view.sections.privateKey')">
        <template v-if="view.privateKey">
          <div class="key-row">
            <Badge kind="ok">{{ view.privateKey.algorithm }}</Badge>
            <span class="mono">{{ view.privateKey.keySize }} bits</span>
            <Badge :kind="view.privateKey.encrypted ? 'warn' : 'neutral'">
              {{ view.privateKey.encrypted ? t("key.encryptedYes") : t("key.encryptedNo") }}
            </Badge>
          </div>
          <Row v-if="view.privateKey.subjectKeyIdentifier" :label="t('cert.subjectKeyIdentifier')" stack>
            <span class="mono fp">{{ view.privateKey.subjectKeyIdentifier }}</span>
          </Row>
        </template>
        <div v-else class="empty">{{ t("view.sections.noPrivateKey") }}</div>
      </Card>

      <Card v-if="view.serverCert" :title="t('view.sections.serverCert')">
        <CertDetail :cert="view.serverCert" />
      </Card>

      <Card :title="t('view.sections.chainCerts')">
        <div v-if="view.chainCerts.length" class="chain-list">
          <div
            v-for="(c, i) in view.chainCerts"
            :key="i"
            class="chain-item"
            :class="{ open: openChainIdx[i] }"
          >
            <button
              type="button"
              class="chain-head"
              :aria-expanded="!!openChainIdx[i]"
              @click="toggleChain(i)"
            >
              <span class="caret">{{ openChainIdx[i] ? "▾" : "▸" }}</span>
              <span class="chain-title">#{{ i + 1 }} · {{ c.subject }}</span>
              <span class="chain-hint">
                {{ openChainIdx[i] ? t("view.collapseHint") : t("view.expandHint") }}
              </span>
            </button>
            <div v-if="openChainIdx[i]" class="chain-body">
              <CertDetail :cert="c" />
            </div>
          </div>
        </div>
        <div v-else class="empty">{{ t("view.sections.noChain") }}</div>
      </Card>

      <Card :title="t('view.sections.structure')">
        <template v-if="view.structure">
          <Row :label="t('view.structure.generation')" stack>
            <Badge :kind="generationKind">{{ generationLabel }}</Badge>
          </Row>
          <Row v-if="view.structure.macAlgorithm" :label="t('view.structure.mac')" stack>
            <span class="mono">
              {{ t('view.structure.macSummary', {
                algorithm: view.structure.macAlgorithm,
                count: view.structure.macIterationCount ?? '?'
              }) }}
            </span>
          </Row>
          <Row v-if="view.structure.keyEncryption" :label="t('view.structure.keyEncryption')" stack>
            <span class="mono">{{ encSummary(view.structure.keyEncryption) }}</span>
          </Row>
          <Row v-if="view.structure.certEncryption" :label="t('view.structure.certEncryption')" stack>
            <span class="mono">{{ encSummary(view.structure.certEncryption) }}</span>
          </Row>
          <Row v-if="view.structure.bags.length" :label="t('view.structure.bags')" stack>
            <ul class="bag-list">
              <li v-for="(b, i) in view.structure.bags" :key="i" class="bag">
                <Badge :kind="b.kind === 'key' ? 'ok' : b.kind === 'cert' ? 'neutral' : 'warn'">
                  {{ bagKindLabel(b.kind) }}
                </Badge>
                <span v-if="b.friendlyName" class="bag-name">{{ b.friendlyName }}</span>
                <span v-if="b.localKeyId" class="bag-lkid mono">{{ b.localKeyId }}</span>
              </li>
            </ul>
          </Row>
        </template>
        <div v-else class="empty">{{ t("view.sections.noStructure") }}</div>
      </Card>
    </template>
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

.key-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  flex-wrap: wrap;
}
.key-row .mono {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink-2);
}
.fp {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-2);
  word-break: break-all;
}

.empty {
  padding: 12px 14px;
  color: var(--muted-2);
  font-size: 12.5px;
  font-style: italic;
}

.chain-list { display: flex; flex-direction: column; gap: 8px; }
.chain-item { border: 1px solid #e5ebf2; border-radius: var(--radius-sm); overflow: hidden; }
.chain-head {
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  border: none;
  background: #eef2f7;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink-2);
  transition: background 0.12s ease;
}
.chain-head:hover { background: #e3e9f1; }
.chain-item.open .chain-head {
  background: #dde6f1;
  border-bottom: 1px solid #c9d4e2;
}
.chain-head .caret { color: var(--muted); width: 10px; }
.chain-head .chain-title {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
}
.chain-head .chain-hint {
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--muted);
  font-style: italic;
}
.chain-body {
  background: #ffffff;
  padding: 4px 0;
}

.bag-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bag {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.bag-name {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink-2);
}
.bag-lkid {
  font-size: 11.5px;
  color: var(--muted);
  word-break: break-all;
}
</style>
