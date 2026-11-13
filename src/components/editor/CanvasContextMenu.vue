<template>
  <div
    v-if="menu.show"
    class="context-menu"
    role="menu"
    :style="{ left: `${place.left}px`, top: `${place.top}px`, maxHeight: `${place.maxHeight}px` }"
    @click.stop
    @contextmenu.prevent
  >
    <template v-if="menu.node">
      <div class="context-menu-title">{{ group ? `${menu.count} nodos seleccionados` : nodeDisplayName(menu.node) }}</div>
      <button class="context-menu-item" role="menuitem" @click="emit('edit', menu.node)">✏️ {{ group ? 'Ver en el inspector' : 'Editar parámetros' }}</button>
      <button class="context-menu-item" role="menuitem" @click="emit('duplicate', menu.node)">⧉ Duplicar{{ group ? ' (con sus conexiones)' : '' }}</button>
      <button class="context-menu-item danger" role="menuitem" @click="emit('delete', menu.node)">🗑️ Eliminar{{ group ? ` ${menu.count} nodos` : '' }}</button>
      <div class="context-menu-sep" role="separator"></div>
      <button class="context-menu-item" role="menuitem" @click="emit('copy', menu.node)">📋 Copiar <kbd>Ctrl+C</kbd></button>
      <button v-if="group || seeded" class="context-menu-item" role="menuitem" @click="emit('new-seed', menu.node)">🎲 {{ group ? 'Nuevas semillas' : 'Nueva semilla' }}</button>
      <button v-if="group || randomizable" class="context-menu-item" role="menuitem" @click="emit('randomize', menu.node)">🔀 Aleatorizar parámetros</button>
    </template>
    <template v-else>
      <div class="context-menu-title">Agregar nodo</div>
      <button
        v-for="entry in entries"
        :key="entry.type"
        class="context-menu-item"
        role="menuitem"
        :title="entry.description"
        @click="emit('add', entry.type, menu.flow)"
      >
        <span class="context-menu-icon" :style="{ background: entry.color }">{{ entry.icon }}</span>
        {{ entry.label }}
      </button>
    </template>
  </div>
</template>

<script setup>
/**
 * Right-click menu of the canvas. The "add node" list comes from the node
 * registry; the node is created at `menu.flow` (the cursor in canvas
 * coordinates, see useContextMenu).
 */
import { computed } from 'vue'
import { paletteEntries, nodeDisplayName } from '../nodes/nodeRegistry.js'
import { menuPlacement } from '../../composables/useContextMenu.js'
import { hasSeed, canRandomize } from '../../audio/graph/nodeParams.js'

const props = defineProps({
  /** { show, x, y, flow, node } from useContextMenu */
  menu: { type: Object, required: true }
})

const emit = defineEmits(['add', 'edit', 'duplicate', 'delete', 'copy', 'new-seed', 'randomize'])

// A right click on a node that is part of a multiple selection acts on the group.
const group = computed(() => (props.menu.count || 0) > 1)
const seeded = computed(() => hasSeed(props.menu.node?.type))
const randomizable = computed(() => canRandomize(props.menu.node?.type))

const entries = paletteEntries()

const place = computed(() => menuPlacement(props.menu.x, props.menu.y, {
  width: 230,
  height: props.menu.node ? 260 : entries.length * 36 + 40,
  viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1024,
  viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 768
}))
</script>

<style scoped>
.context-menu {
  position: fixed;
  background: var(--background-dark);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.35rem 0;
  box-shadow: 0 4px 12px var(--shadow-color);
  z-index: 1000;
  min-width: 200px;
  overflow-y: auto;
}

.context-menu-title {
  padding: 0.25rem 1rem 0.35rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 1rem;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  color: var(--text-primary);
  font-size: 0.85rem;
}

.context-menu-item:hover,
.context-menu-item:focus-visible {
  background: var(--background-light);
  outline: none;
}

.context-menu-sep {
  height: 1px;
  margin: 0.3rem 0;
  background: var(--border-color);
}

.context-menu-item kbd {
  margin-left: auto;
  font-size: 0.65rem;
  color: var(--text-secondary);
}

.context-menu-item.danger {
  color: var(--danger-color);
}

.context-menu-icon {
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  color: #fff;
  flex-shrink: 0;
}
</style>
