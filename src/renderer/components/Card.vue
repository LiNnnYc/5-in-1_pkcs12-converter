<script setup lang="ts">
import { useSlots } from "vue";

defineProps<{
  title?: string;
  subtitle?: string;
}>();

const slots = useSlots();
</script>

<template>
  <section class="card">
    <header v-if="title || slots['head-extra']" class="card-head">
      <h2 v-if="title">{{ title }}</h2>
      <span v-if="subtitle" class="sub">{{ subtitle }}</span>
      <slot name="head-extra" />
    </header>
    <div class="card-body">
      <slot />
    </div>
    <footer v-if="slots.foot" class="card-foot">
      <slot name="foot" />
    </footer>
  </section>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
}
.card + .card,
:deep(.card) + .card { margin-top: 12px; }
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  background: #fafbfc;
  gap: 12px;
}
.card-head h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--muted);
}
.card-head .sub {
  font-size: 11px;
  color: var(--muted);
  margin-left: auto;
}
.card-body { padding: 6px 0; }
.card-foot {
  padding: 10px 14px;
  border-top: 1px solid var(--line);
  display: flex;
  gap: 8px;
  align-items: center;
  background: #fafbfc;
}
</style>
