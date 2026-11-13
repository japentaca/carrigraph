<template>
  <div class="preset-panel">
    <div class="preset-header" @click="expanded = !expanded">
      <h3 class="section-title">
        <span>{{ expanded ? '▼' : '▶' }}</span>
        📦 Presets
      </h3>
    </div>

    <div v-if="expanded" class="preset-body">
      <!-- Save current as preset -->
      <div class="preset-save">
        <input
          v-model="newPresetName"
          type="text"
          placeholder="Nombre del preset..."
          class="preset-input"
          @keyup.enter="saveCurrentPreset"
        />
        <button
          @click="saveCurrentPreset"
          class="btn secondary btn-sm"
          :disabled="!newPresetName.trim() || projectStore.nodes.length === 0"
        >
          💾 Guardar
        </button>
      </div>

      <!-- Categories -->
      <div
        v-for="category in presetStore.categories"
        :key="category.name"
        class="preset-category"
      >
        <div class="category-name">{{ category.name }}</div>

        <div
          v-for="preset in category.presets"
          :key="preset.id"
          class="preset-card"
          :class="{ 'preset-card--active': activePresetId === preset.id }"
        >
          <div class="preset-card__header" @click="togglePreset(preset)">
            <span class="preset-icon">{{ preset.icon }}</span>
            <div class="preset-info">
              <div class="preset-name">{{ preset.name }}</div>
              <div class="preset-desc">{{ preset.description }}</div>
            </div>
          </div>

          <div v-if="activePresetId === preset.id" class="preset-card__actions">
            <button @click="applyPreset(preset)" class="btn btn-sm">
              ▶️ Aplicar
            </button>
            <button
              v-if="!preset.isBuiltIn"
              @click="deletePreset(preset.id)"
              class="btn btn-sm danger"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="presetStore.categories.length === 0" class="preset-empty">
        No hay presets disponibles. Guardá tu configuración actual para crear uno.
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { usePresetStore } from '../stores/usePresetStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useToastStore } from '../stores/useToastStore'
import { migrateProject } from '../audio/graph/migrate.js'

const presetStore = usePresetStore()
const projectStore = useProjectStore()
const toastStore = useToastStore()

const expanded = ref(true)
const activePresetId = ref(null)
const newPresetName = ref('')

onMounted(() => {
  presetStore.loadFromStorage()
})

const togglePreset = (preset) => {
  activePresetId.value = activePresetId.value === preset.id ? null : preset.id
}

/**
 * Aplicar un preset: reemplaza nodos/edges del proyecto con los del preset,
 * generando nuevos IDs para evitar colisiones.
 */
const applyPreset = (preset) => {
  const idMap = {}
  // User presets saved before Fase 3 have no schemaVersion: migrate them.
  const graph = migrateProject({ nodes: preset.nodes, edges: preset.edges, metadata: { schemaVersion: preset.schemaVersion } })

  const newNodes = graph.nodes.map(node => {
    const newId = `${node.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    idMap[node.id] = newId
    return {
      ...JSON.parse(JSON.stringify(node)),
      id: newId
    }
  })

  const newEdges = graph.edges.map(edge => ({
    id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    source: idMap[edge.source] || edge.source,
    target: idMap[edge.target] || edge.target,
    sourceHandle: edge.sourceHandle || undefined,
    targetHandle: edge.targetHandle || undefined,
    ...(edge.style ? { style: { ...edge.style } } : {})
  }))

  // Replace all nodes and edges (new arrays: Vue Flow resyncs; one undo entry)
  projectStore.replaceGraph(newNodes, newEdges)

  toastStore.success(`Preset "${preset.name}" aplicado`)
}

/**
 * Guardar la configuración actual como nuevo preset.
 */
const saveCurrentPreset = () => {
  const name = newPresetName.value.trim()
  if (!name) return

  if (projectStore.nodes.length === 0) {
    toastStore.warning('No hay nodos para guardar como preset')
    return
  }

  presetStore.saveCurrentAsPreset(name, projectStore.nodes, projectStore.edges)
  newPresetName.value = ''
  toastStore.success(`Preset "${name}" guardado`)
}

/**
 * Eliminar un preset de usuario.
 */
const deletePreset = (presetId) => {
  presetStore.deletePreset(presetId)
  if (activePresetId.value === presetId) {
    activePresetId.value = null
  }
  toastStore.info('Preset eliminado')
}
</script>

<style scoped>
.preset-panel {
  margin-bottom: 1rem;
}

.preset-header {
  cursor: pointer;
  user-select: none;
}

.section-title {
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.preset-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.preset-save {
  display: flex;
  gap: 0.5rem;
}

.preset-input {
  flex: 1;
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.35rem 0.5rem;
  color: var(--text-primary);
  font-size: 0.8rem;
}

.preset-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.btn-sm {
  padding: 0.3rem 0.6rem;
  font-size: 0.75rem;
}

.preset-category {
  margin-bottom: 0.25rem;
}

.category-name {
  color: var(--text-secondary);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.4rem;
}

.preset-card {
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin-bottom: 0.35rem;
  transition: border-color 0.2s ease;
}

.preset-card:hover {
  border-color: var(--primary-color);
}

.preset-card--active {
  border-color: var(--primary-color);
}

.preset-card__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  cursor: pointer;
}

.preset-icon {
  font-size: 1.1rem;
  width: 1.6rem;
  text-align: center;
  flex-shrink: 0;
}

.preset-info {
  flex: 1;
  min-width: 0;
}

.preset-name {
  color: var(--text-primary);
  font-size: 0.8rem;
  font-weight: 500;
}

.preset-desc {
  color: var(--text-secondary);
  font-size: 0.7rem;
  line-height: 1.3;
}

.preset-card__actions {
  display: flex;
  gap: 0.35rem;
  padding: 0.35rem 0.6rem 0.5rem;
  border-top: 1px solid var(--border-color);
}

.btn.danger {
  background: var(--danger-color);
}

.btn.danger:hover {
  background: var(--danger-hover);
}

.preset-empty {
  color: var(--text-secondary);
  font-size: 0.8rem;
  text-align: center;
  padding: 1rem 0;
}
</style>
