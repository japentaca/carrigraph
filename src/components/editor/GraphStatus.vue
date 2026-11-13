<template>
  <div v-if="diagnostics.length || hasTracks" class="graph-status" role="status" aria-live="polite">
    <span v-if="hasTracks" class="graph-status__tracks">
      <span aria-hidden="true">🎚️</span>
      {{ compiled.score.tracks.length }} {{ compiled.score.tracks.length === 1 ? 'pista' : 'pistas' }}:
      {{ compiled.score.tracks.map(t => `${t.name} (${t.length})`).join(' · ') }}
    </span>
    <button
      v-if="diagnostics.length"
      type="button"
      class="graph-status__toggle"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span aria-hidden="true">{{ worst === 'info' ? 'ℹ️' : '⚠️' }}</span>
      {{ diagnostics.length === 1 && !open ? diagnostics[0].message : `${diagnostics.length} ${diagnostics.length === 1 ? 'aviso' : 'avisos'} del grafo` }}
      <span aria-hidden="true">{{ open ? '▴' : '▾' }}</span>
    </button>
    <ul v-if="open && diagnostics.length" class="graph-status__list">
      <li v-for="(d, i) in diagnostics" :key="i">{{ d.level === 'info' ? 'ℹ️' : '⚠️' }} {{ d.message }}</li>
    </ul>
  </div>
</template>

<script setup>
/**
 * Graph-level status: diagnostics without a node and the track list.
 * Fase 4B: a strip above the canvas instead of a box floating over it (the
 * box could cover the first node after Auto Layout / fit view). Long lists
 * fold behind a button.
 */
import { ref, computed } from 'vue'

const props = defineProps({
  compiled: { type: Object, required: true },
  diagnostics: { type: Array, default: () => [] }
})

const open = ref(false)
const hasTracks = computed(() => props.compiled.mode === 'tracks' && props.compiled.score.tracks.length > 0)
const worst = computed(() => (props.diagnostics.some(d => d.level !== 'info') ? 'warning' : 'info'))
</script>

<style scoped>
.graph-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.75rem;
  padding: 0.3rem 0.75rem;
  background: var(--background-light);
  border-bottom: 1px solid var(--border-color);
  font-size: 0.75rem;
  color: var(--text-secondary);
  flex: none;
}
.graph-status__tracks { color: var(--text-primary); }
.graph-status__toggle {
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  text-align: left;
}
.graph-status__toggle:hover { border-color: var(--border-color); color: var(--text-primary); }
.graph-status__list {
  flex-basis: 100%;
  list-style: none;
  margin: 0;
  padding: 0 0 0.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
</style>
