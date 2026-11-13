<template>
  <VueFlow
    :id="flowId"
    :nodes="flowNodes"
    :edges="flowEdges"
    :nodes-draggable="false"
    :nodes-connectable="false"
    :elements-selectable="false"
    :edges-updatable="false"
    :delete-key-code="null"
    :fit-view-on-init="true"
    :min-zoom="0.05"
    class="readonly-graph"
    :aria-label="ariaLabel"
  />
</template>

<script setup>
/**
 * Read-only drawing of a (migrated) graph: one labelled box per node with the
 * color of its type, and the edges. Nothing can be moved, connected, selected
 * or deleted. Used by the version history preview (Fase 4A) and by the
 * shared / gallery player (Fase 5A).
 */
import { computed } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { getNodeEntry, nodeDisplayName } from './nodes/nodeRegistry.js'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  edges: { type: Array, default: () => [] },
  /** Vue Flow id (each instance on screen needs its own) */
  flowId: { type: String, required: true },
  ariaLabel: { type: String, default: 'Grafo del proyecto (solo lectura)' }
})

/** Graph node → Vue Flow default node with a label. */
function readOnlyNode(n) {
  const entry = getNodeEntry(n.type)
  return {
    id: String(n.id),
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    data: { label: `${entry?.icon || '•'} ${nodeDisplayName(n)}` },
    sourcePosition: 'right',
    targetPosition: 'left',
    draggable: false,
    connectable: false,
    selectable: false,
    style: { borderColor: entry?.color || '#737373', borderWidth: '2px', fontSize: '11px', width: '160px' }
  }
}

const flowNodes = computed(() => (props.nodes || []).map(readOnlyNode))

const flowEdges = computed(() => (props.edges || []).map((e, i) => ({
  id: String(e.id ?? `e${i}`),
  source: String(e.source),
  target: String(e.target),
  style: e.style,
  selectable: false,
  updatable: false
})))
</script>

<style scoped>
.readonly-graph {
  width: 100%;
  height: 100%;
}
</style>
