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
      <div class="lbl-text">{{ label }}</div>
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
/* lbl-text owns the wrapping behaviour:
   - `white-space: pre-line` honours explicit `\n` from i18n strings so
     translators can pick exact line-break positions (e.g. "中繼 / 根\n憑證").
   - `text-wrap: balance` lets Chromium auto-balance lines when there is no
     explicit `\n` so unmarked translations don't end up with a single dangling
     word on the second line. Both rules coexist without conflict. */
.lbl-text {
  white-space: pre-line;
  text-wrap: balance;
}
/* `margin-left: auto` pushes the marker to the right edge of the label grid
   cell — i.e. flush against the input column — independent of label length or
   line count. Matches the `var(--label-w)` column width set on `.row`. */
.lbl .req {
  margin-left: auto;
  color: oklch(0.58 0.18 25);
  font-weight: 700;
  font-size: 11px;
}
.lbl .opt {
  margin-left: auto;
  color: var(--muted-2);
  font-weight: 400;
  font-size: 11px;
}
.ctl { min-width: 0; }
.hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
</style>
