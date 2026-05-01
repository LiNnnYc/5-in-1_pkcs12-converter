<script setup lang="ts">
export type IconName =
  | "merge" | "extract" | "view" | "swap" | "shield"
  | "file" | "folder" | "x" | "check" | "alert" | "info"
  | "settings" | "chevron" | "power" | "key" | "eye" | "eyeOff" | "refresh";

defineProps<{
  name: IconName;
  size?: number;
}>();
</script>

<template>
  <svg
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <g v-if="name === 'merge'">
      <circle cx="6" cy="5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="18" cy="5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.8" fill="currentColor" stroke="none" />
      <path d="M6 7v3a4 4 0 0 0 4 4h2" />
      <path d="M18 7v3a4 4 0 0 1-4 4h-2" />
      <path d="M12 14v3.2" />
    </g>
    <g v-else-if="name === 'extract'">
      <path d="M4 4h10l6 6v10H4z" />
      <path d="M14 4v6h6" />
      <path d="M12 18v-6" />
      <path d="M9 15l3 3 3-3" />
    </g>
    <g v-else-if="name === 'view'">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </g>
    <g v-else-if="name === 'swap'">
      <path d="M4 8h14l-3-3" />
      <path d="M20 16H6l3 3" />
    </g>
    <g v-else-if="name === 'shield'">
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
    </g>
    <g v-else-if="name === 'file'">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </g>
    <g v-else-if="name === 'folder'">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </g>
    <g v-else-if="name === 'x'">
      <path d="M6 6l12 12M18 6L6 18" />
    </g>
    <g v-else-if="name === 'check'">
      <path d="M5 12l5 5L20 7" />
    </g>
    <g v-else-if="name === 'alert'">
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </g>
    <g v-else-if="name === 'info'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v.5M12 11v5" />
    </g>
    <g v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </g>
    <g v-else-if="name === 'chevron'">
      <path d="M9 6l6 6-6 6" />
    </g>
    <g v-else-if="name === 'power'">
      <path d="M12 3v9" />
      <path d="M5.6 7.6a8 8 0 1 0 12.8 0" />
    </g>
    <g v-else-if="name === 'key'">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3M14 9l3 3" />
    </g>
    <g v-else-if="name === 'eye'">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </g>
    <g v-else-if="name === 'refresh'">
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
      <path d="M3 21v-5h5" />
    </g>
    <g v-else-if="name === 'eyeOff'">
      <path d="M3 3l18 18" />
      <path d="M10.5 10.7a2 2 0 0 0 2.8 2.8" />
      <path d="M9.9 5.1A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.9-1.3" />
    </g>
  </svg>
</template>
