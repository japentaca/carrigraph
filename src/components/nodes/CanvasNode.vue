<template>
  <div
    class="cgn"
    :class="[diagClass, { 'cgn--selected': selected, 'cgn--expanded': open, 'cgn--active': active && audioStore.isPlaying }]"
    :style="{ '--node-color': color }"
  >
    <NodeDiagnostics :items="diagnostics" />
    <NodePorts :type="type" />

    <div class="cgn__header">
      <span class="cgn__icon" aria-hidden="true">{{ entry?.icon }}</span>
      <span class="cgn__title" :title="name">{{ name }}</span>
      <button
        type="button"
        class="cgn__toggle nodrag"
        :aria-expanded="open"
        :aria-label="open ? `Ocultar parámetros de ${name}` : `Mostrar parámetros de ${name}`"
        :title="open ? 'Ocultar parámetros' : 'Editar parámetros acá'"
        @click.stop="ui.toggleExpanded(id)"
      ><span aria-hidden="true">{{ open ? '▴' : '▾' }}</span></button>
    </div>

    <div class="cgn__summary">{{ summary }}</div>

    <NodePreview
      v-if="preview"
      class="cgn__preview"
      :preview="preview"
      :active="active"
      :width="previewWidth"
      :color="color"
    />

    <SeedControls
      v-if="seeded"
      class="cgn__seed"
      compact
      :node="{ id, type, data }"
      @update="(d) => emit('update', d)"
    />

    <div v-if="open" class="cgn__body nodrag nowheel" @dblclick.stop>
      <component :is="entry?.component" :data="data" @update="(d) => emit('update', d)" />
    </div>
  </div>
</template>

<script setup>
/**
 * A node on the canvas (Fase 4B). Compact by default: ports, header, a
 * one-line summary, the thumbnail of what it outputs (with the playing step)
 * and, for nodes with a seed, the seed controls. The ▾ button expands it to
 * edit every parameter right here; the inspector shows the same panel (same
 * component, same store action), so both always agree.
 */
import { computed } from 'vue'
import NodePorts from './NodePorts.vue'
import NodeDiagnostics from './NodeDiagnostics.vue'
import NodePreview from './NodePreview.vue'
import SeedControls from './SeedControls.vue'
import { getNodeEntry, nodeDisplayName } from './nodeRegistry.js'
import { hasSeed } from '../../audio/graph/nodeParams.js'
import { nodeSummary } from '../../editor/nodeView.js'
import { useEditorUi } from '../../composables/useEditorUi.js'
import { useAudioStore } from '../../stores/useAudioStore'

const props = defineProps({
  id: { type: String, required: true },
  type: { type: String, required: true },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  diagnostics: { type: Array, default: () => [] },
  diagClass: { type: String, default: '' },
  preview: { type: Object, default: null },
  active: { type: Boolean, default: false }
})
const emit = defineEmits(['update'])

const ui = useEditorUi()
const audioStore = useAudioStore()

const entry = computed(() => getNodeEntry(props.type))
const name = computed(() => nodeDisplayName({ type: props.type, data: props.data }))
const color = computed(() => props.data?.color || entry.value?.color || '#737373')
const summary = computed(() => nodeSummary({ type: props.type, data: props.data }))
const seeded = computed(() => hasSeed(props.type))
const open = computed(() => ui.isExpanded(props.id))
const previewWidth = computed(() => (open.value ? 236 : 172))
</script>

<style>
/* Global: Vue Flow wraps every node in .vue-flow__node; the look is here. */
.cgn {
  position: relative;
  width: 196px;
  background: var(--background-light);
  border: 2px solid var(--border-color);
  border-left: 5px solid var(--node-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 12px;
  padding-bottom: 0.45rem;
}
.cgn--expanded { width: 264px; }
/* An expanded node is drawn above its neighbours (Vue Flow paints nodes in
   order, so a later neighbour used to cover the open panel). Neighbours are
   not moved: the panel may still cover them until it is folded (▾). */
.vue-flow__node:has(> .cgn--expanded) { z-index: 1000 !important; }
.cgn--selected {
  border-color: var(--primary-color);
  border-left-color: var(--node-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 35%, transparent);
}
.cgn.cg-node-wrap--error { border-color: var(--danger-color); }
.cgn.cg-node-wrap--warning { border-color: var(--warning-color); }
.cgn--selected.cg-node-wrap--error, .cgn--selected.cg-node-wrap--warning { border-color: var(--primary-color); }
.cgn__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.4rem 0.2rem 0.55rem;
  font-weight: 600;
}
.cgn__icon {
  width: 1.4rem;
  height: 1.4rem;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: color-mix(in srgb, var(--node-color) 28%, transparent);
  font-size: 0.8rem;
}
.cgn__title {
  flex: 1;
  min-width: 0;
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cgn__toggle {
  flex: none;
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.85rem;
  width: 1.6rem;
  height: 1.5rem;
}
.cgn__toggle:hover { border-color: var(--border-color); color: var(--text-primary); }
.cgn__summary {
  padding: 0 0.55rem 0.3rem;
  color: var(--text-secondary);
  font-size: 0.7rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cgn__preview { margin: 0 0.55rem 0.3rem; }
.cgn__seed { padding: 0 0.55rem; }
.cgn__body {
  margin-top: 0.45rem;
  padding: 0.55rem 0.55rem 0.1rem;
  border-top: 1px solid var(--border-color);
  cursor: default;
}
</style>
