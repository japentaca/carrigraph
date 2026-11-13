<template>
  <div v-if="items && items.length" class="cg-diag" :class="'cg-diag--' + worst">
    <div v-for="(d, i) in items" :key="i" class="cg-diag__item" :title="d.code">
      <span class="cg-diag__icon" :aria-label="levelLabel(d.level)">{{ icon(d.level) }}</span>{{ d.message }}
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] }
})

const ORDER = { error: 0, warning: 1, info: 2 }
const worst = computed(() => props.items.reduce((w, d) => (ORDER[d.level] < ORDER[w] ? d.level : w), 'info'))
const levelLabel = (level) => (level === 'error' ? 'Error:' : level === 'warning' ? 'Aviso:' : 'Info:')
const icon = (level) => (level === 'error' ? '⛔' : level === 'warning' ? '⚠️' : 'ℹ️')
</script>

<style>
.cg-diag {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  max-width: 260px;
  padding: 0.3rem 0.5rem;
  border-radius: 6px;
  font-size: 10px;
  line-height: 1.3;
  pointer-events: none;
  z-index: 5;
  border: 1px solid;
}
.cg-diag--error { background: color-mix(in srgb, var(--danger-color) 14%, var(--background-light)); border-color: var(--danger-color); color: var(--text-primary); }
.cg-diag--warning { background: color-mix(in srgb, var(--warning-color) 14%, var(--background-light)); border-color: var(--warning-color); color: var(--text-primary); }
.cg-diag--info { background: color-mix(in srgb, var(--primary-color) 14%, var(--background-light)); border-color: var(--primary-color); color: var(--text-primary); }
.cg-diag__icon { margin-right: 0.25rem; }
</style>
