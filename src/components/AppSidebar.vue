<template>
  <aside class="sidebar" aria-label="Paleta, presets y acciones del proyecto">
    <div class="sidebar-head">
      <h2 class="section-title">Paleta de nodos</h2>
      <button type="button" class="sidebar-close" aria-label="Cerrar panel lateral" title="Cerrar panel" @click="emit('close')">
        <span aria-hidden="true">×</span>
      </button>
    </div>
    <!-- Node Palette -->
    <div class="sidebar-section">
      <input
        v-model="filter"
        class="palette-filter"
        type="search"
        placeholder="Filtrar…"
        aria-label="Filtrar tipos de nodo"
      />
      <div class="node-palette" role="list">
        <button
          v-for="nodeType in visibleTypes"
          :key="nodeType.type"
          type="button"
          role="listitem"
          class="palette-item"
          :draggable="true"
          :title="`Clic: agregar al centro · Arrastrar: soltar en el lienzo`"
          @dragstart="onDragStart($event, nodeType)"
          @click="emit('add-node', nodeType.type)"
        >
          <span class="palette-icon" :style="{ backgroundColor: nodeType.color }" aria-hidden="true">
            {{ nodeType.icon }}
          </span>
          <span class="palette-info">
            <span class="palette-name">{{ nodeType.label }}</span>
            <span class="palette-description">{{ nodeType.description }}</span>
          </span>
        </button>
        <p v-if="!visibleTypes.length" class="palette-none">Ningún tipo coincide.</p>
      </div>
    </div>

    <!-- Presets -->
    <div class="sidebar-section">
      <PresetPanel />
    </div>
    
    <!-- Project Info -->
    <div class="sidebar-section">
      <h3 class="section-title">Proyecto</h3>
      <div class="project-info">
        <div class="info-item">
          <span class="info-label">Nodos:</span>
          <span class="info-value">{{ projectStore.nodes.length }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Conexiones:</span>
          <span class="info-value">{{ projectStore.edges.length }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Estado:</span>
          <span :class="['info-value', 'status', projectStatus.class]">
            {{ projectStatus.text }}
          </span>
        </div>
      </div>
    </div>
    
    <!-- Quick Actions -->
    <div class="sidebar-section">
      <h3 class="section-title">Acciones</h3>
      <div class="quick-actions">
        <button @click="clearCanvas" class="btn secondary full-width">
          🗑️ Limpiar lienzo
        </button>
        <button @click="emit('auto-layout')" class="btn secondary full-width">
          📐 Auto Layout
        </button>
        <button @click="exports.exportProjectFile()" class="btn secondary full-width">
          💾 Exportar .cgproj
        </button>
        <button @click="emit('import-project')" class="btn secondary full-width">
          📂 Importar .cgproj
        </button>
        <button @click="toggleTheme" class="btn secondary full-width">
          {{ isDark ? '☀️ Modo claro' : '🌙 Modo oscuro' }}
        </button>
      </div>
    </div>
    
    <!-- Help -->
    <div class="sidebar-section">
      <h3 class="section-title">Ayuda</h3>
      <div class="help-content">
        <div class="help-item">
          <strong>Clic</strong> en un tipo de la paleta lo agrega en el centro; <strong>arrastralo</strong> para soltarlo donde quieras
        </div>
        <div class="help-item">
          <strong>Doble clic</strong> o <strong>Tab</strong> en el lienzo: buscar un nodo y crearlo ahí (también clic derecho)
        </div>
        <div class="help-item">
          <strong>Soltá una conexión en el vacío</strong>: crea un nodo compatible ya conectado
        </div>
        <div class="help-item">
          <strong>Clic</strong> en un nodo: sus parámetros en el inspector; <strong>▾</strong>: editarlos en el nodo
        </div>
        <div class="help-item">
          <strong>Shift</strong> + clic o arrastrar con Shift: seleccionar varios (copiar, pegar, alinear)
        </div>
        <div class="help-item">
          <strong>Arrastrá</strong> de una salida a una entrada del mismo color para conectar
        </div>
        <div class="help-item">
          Los cambios se escuchan en vivo si está sonando (Espacio para reproducir)
        </div>
      </div>
    </div>

    <ConfirmDialog
      :visible="showClearConfirm"
      title="¿Limpiar el canvas?"
      message="Esto eliminará todos los nodos y conexiones. Se puede deshacer con Ctrl+Z."
      confirm-text="Limpiar canvas"
      cancel-text="Cancelar"
      type="danger"
      @confirm="onClearConfirmed"
      @cancel="showClearConfirm = false"
    />
  </aside>
</template>

<script setup>
/**
 * Editor sidebar: node palette (from the node registry), presets, project
 * info and project actions. The transport controls (play, tempo, loop,
 * volume) live in the transport bar (Fase 4A); exports in the toolbar.
 */
import { ref, computed } from 'vue'
import { useProjectStore } from '../stores/useProjectStore'
import { useTheme } from '../composables/useTheme.js'
import { useExports } from '../composables/useExports.js'
import PresetPanel from './PresetPanel.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { paletteEntries, NODE_DRAG_TYPE } from './nodes/nodeRegistry.js'
import { searchPalette } from '../editor/palette.js'

const emit = defineEmits(['add-node', 'auto-layout', 'clear', 'import-project', 'close'])

const projectStore = useProjectStore()
const { isDark, toggle: toggleTheme } = useTheme()
const exports = useExports()

// Palette entries come from the single node registry.
const nodeTypes = paletteEntries()
const filter = ref('')
const visibleTypes = computed(() => searchPalette(nodeTypes, filter.value))

const projectStatus = computed(() => {
  const nodeCount = projectStore.nodes.length
  const edgeCount = projectStore.edges.length
  
  if (nodeCount === 0) {
    return { text: 'Vacío', class: 'empty' }
  } else if (edgeCount === 0) {
    return { text: 'Sin conexiones', class: 'warning' }
  } else {
    return { text: 'Conectado', class: 'success' }
  }
})

const onDragStart = (event, nodeType) => {
  event.dataTransfer.setData(NODE_DRAG_TYPE, nodeType.type)
  event.dataTransfer.effectAllowed = 'copy'
}

const showClearConfirm = ref(false)

const clearCanvas = () => {
  showClearConfirm.value = true
}

const onClearConfirmed = () => {
  showClearConfirm.value = false
  emit('clear')
}
</script>

<style scoped>
.sidebar {
  width: 300px;
  background: var(--background-dark);
  border-right: 1px solid var(--border-color);
  height: 100%;
  overflow-y: auto;
  padding: 1rem;
}

.sidebar-section {
  margin-bottom: 2rem;
}

.section-title {
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border-color);
}

.sidebar-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.sidebar-head .section-title { flex: 1; }

.sidebar-close {
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 1.25rem;
  width: 2rem;
  height: 2rem;
  cursor: pointer;
}

.sidebar-close:hover { border-color: var(--border-color); color: var(--text-primary); }

.palette-filter {
  width: 100%;
  margin-bottom: 0.6rem;
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  color: var(--text-primary);
  font-size: 0.8rem;
}

.palette-none { color: var(--text-secondary); font-size: 0.8rem; }

.node-palette {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--background-light);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.45rem 0.6rem;
  cursor: grab;
  transition: all 0.2s ease;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
}

.palette-item:hover {
  border-color: var(--primary-color);
}

.palette-item:active {
  cursor: grabbing;
  transform: translateY(0);
}

.palette-icon {
  width: 2rem;
  height: 2rem;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  color: white;
  flex-shrink: 0;
}

.palette-info {
  flex: 1;
  min-width: 0;
}

.palette-name {
  display: block;
  color: var(--text-primary);
  font-weight: 500;
  font-size: 0.85rem;
  margin-bottom: 0.1rem;
}

.palette-description {
  display: block;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.3;
}

.project-info {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.info-label {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.info-value {
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
}

.status.empty {
  color: var(--text-secondary);
}

.status.warning {
  color: var(--warning-color);
}

.status.success {
  color: var(--accent-color);
}

.quick-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.full-width {
  width: 100%;
  justify-content: center;
}

.help-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.help-item {
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.4;
}

.help-item strong {
  color: var(--text-primary);
}
</style>