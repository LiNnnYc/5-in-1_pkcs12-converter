<script setup lang="ts">
defineProps<{
  modelValue: string;
  options: Array<{ value: string; label: string }>;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
}>();
</script>

<template>
  <div class="seg" role="radiogroup">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === o.value"
      :class="{ on: modelValue === o.value }"
      :data-label="o.label"
      @click="emit('update:modelValue', o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.seg {
  display: inline-flex;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: white;
}
.seg button {
  border: none;
  background: none;
  cursor: pointer;
  padding: 5px 12px;
  font-size: 12.5px;
  color: var(--ink-2);
  border-right: 1px solid var(--line-2);
  position: relative;
  font-family: inherit;
}
.seg button::after {
  content: attr(data-label);
  display: block;
  font-weight: 600;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
}
.seg button:last-child { border-right: none; }
.seg button:hover:not(.on) { background: #f1f5f9; }
.seg button.on {
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-weight: 600;
}
</style>
