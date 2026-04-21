<script setup lang="ts">
withDefaults(
  defineProps<{
    kind?: "ok" | "warn" | "neutral";
  }>(),
  { kind: "neutral" }
);
</script>

<template>
  <span class="badge" :class="kind"><slot /></span>
</template>

<style scoped>
.badge {
  padding: 3px 10px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid transparent;
  display: inline-block;
  white-space: nowrap;
}
.badge.ok { background: var(--ok-bg); border-color: var(--ok-bd); color: var(--ok-ink); }
.badge.warn { background: var(--warn-bg); border-color: var(--warn-bd); color: var(--warn-ink); }
.badge.neutral { background: var(--chip); color: var(--chip-ink); border-color: var(--line); }
</style>
