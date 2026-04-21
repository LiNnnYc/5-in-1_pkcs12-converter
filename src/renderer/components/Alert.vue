<script setup lang="ts">
import { computed } from "vue";
import Icon, { type IconName } from "./Icon.vue";

export type AlertKind = "info" | "warn" | "ok" | "err";

const props = withDefaults(
  defineProps<{
    kind?: AlertKind;
    title?: string;
  }>(),
  { kind: "info" }
);

const icon = computed<IconName>(() => {
  switch (props.kind) {
    case "warn": return "alert";
    case "ok": return "check";
    case "err": return "alert";
    default: return "info";
  }
});
</script>

<template>
  <div class="alert" :class="kind">
    <div class="ico"><Icon :name="icon" :size="15" /></div>
    <div class="body">
      <div v-if="title" class="title"><strong>{{ title }}</strong></div>
      <div class="content"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.alert {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  font-size: 12.5px;
}
.alert.info { background: var(--info-bg); border-color: var(--info-bd); color: var(--info-ink); }
.alert.warn { background: var(--warn-bg); border-color: var(--warn-bd); color: var(--warn-ink); }
.alert.ok { background: var(--ok-bg); border-color: var(--ok-bd); color: var(--ok-ink); }
.alert.err { background: var(--err-bg); border-color: var(--err-bd); color: var(--err-ink); }
.ico { flex: 0 0 16px; margin-top: 1px; }
.body { min-width: 0; }
.title { margin-bottom: 2px; }
</style>
