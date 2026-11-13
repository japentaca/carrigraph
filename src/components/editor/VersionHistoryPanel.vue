<template>
  <aside class="history" role="dialog" aria-label="Historial de versiones" @keydown.esc.stop="close">
    <div class="history__header">
      <h3>🕘 Historial de versiones</h3>
      <button ref="closeBtn" class="close-btn" aria-label="Cerrar historial" @click="close">×</button>
    </div>

    <p class="history__hint">
      Cada guardado que cambia el grafo crea una versión (se conservan las últimas 50).
      Restaurar crea una versión nueva con el contenido elegido: no se pierde nada.
    </p>

    <div v-if="h.loading.value" class="history__empty">Cargando…</div>
    <div v-else-if="h.error.value" class="history__empty">{{ h.error.value }}</div>
    <div v-else-if="!h.versions.value.length" class="history__empty">Todavía no hay versiones.</div>

    <ul v-else class="history__list">
      <li v-for="v in h.versions.value" :key="v.version_number">
        <button
          class="history__item"
          :class="{ 'history__item--active': h.selected.value?.version_number === v.version_number }"
          @click="h.select(v.version_number)"
        >
          <span class="history__num">v{{ v.version_number }}</span>
          <span class="history__date">{{ formatDate(v.created_at) }}</span>
          <span class="history__meta">
            {{ v.node_count }} nodos · {{ v.edge_count }} conexiones
            <template v-if="v.metadata?.restored_from_version"> · restaurada de v{{ v.metadata.restored_from_version }}</template>
            <template v-if="v.version_number === latest"> · actual</template>
          </span>
        </button>
      </li>
    </ul>

    <section v-if="h.loadingVersion.value" class="history__preview history__empty">Cargando versión…</section>
    <section v-else-if="h.selected.value && summary" class="history__preview">
      <h4>Versión {{ h.selected.value.version_number }}</h4>
      <div class="history__graph">
        <ReadOnlyGraph
          flow-id="cg-version-preview"
          :nodes="h.selected.value.nodes || []"
          :edges="h.selected.value.edges || []"
          aria-label="Vista previa de la versión (solo lectura)"
        />
      </div>
      <p class="history__line">
        {{ summary.tracks.length }} {{ summary.tracks.length === 1 ? 'pista' : 'pistas' }}<template v-if="summary.tracks.length">:
          {{ summary.tracks.map(t => `${t.name} (${t.length})`).join(' · ') }}</template>
        <template v-if="summary.mode === 'compat'"> (modo compatibilidad)</template>
      </p>
      <p class="history__line">{{ summary.settings.tempo }} BPM · swing {{ Math.round(summary.settings.swing * 100) }}%</p>
      <p class="history__line history__line--muted">
        {{ summary.nodeCounts.map(c => `${c.count}× ${c.name}`).join(', ') || 'Sin nodos' }}
      </p>

      <div class="history__actions">
        <button class="btn secondary" :disabled="!summary.tracks.length" @click="toggleListen">
          {{ h.listening.value === h.selected.value.version_number ? '⏹ Detener' : '▶ Escuchar' }}
        </button>
        <button
          v-if="!confirming"
          class="btn"
          :disabled="h.restoring.value"
          @click="askRestore"
        >
          ↺ Restaurar esta versión
        </button>
      </div>
      <div v-if="confirming" class="history__confirm">
        <p>
          El editor va a cargar la versión {{ h.selected.value.version_number }}.
          <strong v-if="dirty">Tus cambios sin guardar se pierden.</strong>
        </p>
        <button class="btn secondary" @click="confirming = false">Cancelar</button>
        <button class="btn" :disabled="h.restoring.value" @click="doRestore">
          {{ h.restoring.value ? 'Restaurando…' : 'Restaurar' }}
        </button>
      </div>
    </section>
  </aside>
</template>

<script setup>
/**
 * Version history (Fase 4A): list, preview (migrated graph drawn read-only,
 * its tracks, tempo; it can be listened to) and restore.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useProjectStore } from '../../stores/useProjectStore'
import ReadOnlyGraph from '../ReadOnlyGraph.vue'

const props = defineProps({
  /** useVersionHistory() of the editor */
  h: { type: Object, required: true }
})
const emit = defineEmits(['restored'])

const projectStore = useProjectStore()
const confirming = ref(false)
// Non-modal side panel: it takes the focus when it opens and closes with Escape.
const closeBtn = ref(null)
onMounted(() => closeBtn.value?.focus({ preventScroll: true }))
const dirty = computed(() => projectStore.isDirty)
const summary = computed(() => props.h.summary.value)
const latest = computed(() => props.h.versions.value[0]?.version_number)

watch(() => props.h.selected.value?.version_number, () => { confirming.value = false })

/** SQLite dates are UTC without a zone ("YYYY-MM-DD HH:MM:SS[.SSS]"). */
function formatDate(value) {
  if (!value) return ''
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${String(value).replace(' ', 'T')}Z`)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function toggleListen() {
  if (props.h.listening.value != null) props.h.stopListening()
  else props.h.listen()
}

function askRestore() {
  confirming.value = true
}

async function doRestore() {
  const n = props.h.selected.value?.version_number
  const ok = await props.h.restore(n)
  confirming.value = false
  if (ok) emit('restored', n)
}

function close() {
  props.h.hide()
}
</script>

<style scoped>
.history {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(440px, 100vw);
  background: var(--background-light);
  border-left: 1px solid var(--border-color);
  box-shadow: -8px 0 24px var(--shadow-color);
  z-index: 1500;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  color: var(--text-primary);
}

.history__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem 0.5rem;
}

.history__header h3 {
  margin: 0;
  font-size: 1.05rem;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
}

.history__hint {
  margin: 0 1.25rem 0.75rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.history__empty {
  padding: 1rem 1.25rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.history__list {
  list-style: none;
  margin: 0;
  padding: 0 0.75rem;
  max-height: 34vh;
  overflow-y: auto;
  flex-shrink: 0;
}

.history__item {
  display: grid;
  grid-template-columns: 3rem 1fr;
  gap: 0 0.5rem;
  width: 100%;
  text-align: left;
  padding: 0.45rem 0.5rem;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--text-primary);
  cursor: pointer;
}

.history__item:hover {
  background: var(--background-dark);
}

.history__item--active {
  border-color: var(--primary-color);
  background: var(--background-dark);
}

.history__num {
  grid-row: span 2;
  font-weight: 600;
  align-self: center;
}

.history__date {
  font-size: 0.8rem;
}

.history__meta {
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.history__preview {
  border-top: 1px solid var(--border-color);
  margin-top: 0.5rem;
  padding: 0.75rem 1.25rem 1.25rem;
}

.history__preview h4 {
  margin: 0 0 0.5rem;
}

.history__graph {
  height: 200px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
  background: var(--background-dark);
  margin-bottom: 0.5rem;
}

.history__line {
  margin: 0.2rem 0;
  font-size: 0.8rem;
}

.history__line--muted {
  color: var(--text-secondary);
  font-size: 0.72rem;
}

.history__actions,
.history__confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.history__confirm p {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.8rem;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
