<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    required?: boolean;
    optional?: boolean;
    stack?: boolean;
    hint?: string;
  }>(),
  { required: false, optional: false, stack: false }
);
</script>

<template>
  <div class="row" :class="{ stack }">
    <div class="lbl">
      <span>{{ label }}</span>
      <span v-if="required" class="req" aria-hidden="true">●</span>
      <span v-if="optional" class="opt">{{ $t("common.optional") }}</span>
    </div>
    <div class="ctl">
      <slot />
      <div v-if="hint" class="hint">{{ hint }}</div>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: var(--label-w) 1fr;
  align-items: center;
  padding: var(--row-pad);
  padding-left: 14px;
  padding-right: 14px;
  gap: 14px;
  border-bottom: 1px solid #f1f4f8;
}
.row:last-child { border-bottom: none; }
.row.stack { align-items: start; padding-top: 10px; padding-bottom: 10px; }
.lbl {
  font-weight: 500;
  font-size: 13px;
  color: var(--ink-2);
  display: flex;
  align-items: center;
  gap: 6px;
}
.lbl .req { color: oklch(0.58 0.18 25); font-weight: 700; font-size: 11px; }
.lbl .opt { color: var(--muted-2); font-weight: 400; font-size: 11px; }
.ctl { min-width: 0; }
.hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
</style>
