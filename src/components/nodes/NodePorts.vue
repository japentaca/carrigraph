<template>
  <!-- Typed ports from the node registry: inputs left, outputs right. -->
  <template v-for="(p, i) in inputs" :key="'in-' + p.id">
    <Handle
      type="target"
      :position="Position.Left"
      :id="p.id"
      :class="['cg-port', 'cg-port--' + p.type]"
      :style="handleStyle(p, i)"
      :title="`${p.label} (${typeLabel(p.type)})`"
    />
    <span class="cg-port-label cg-port-label--in" :style="{ top: top(i) + 'px', color: color(p.type) }">{{ p.label }}</span>
  </template>
  <template v-for="(p, i) in outputs" :key="'out-' + p.id">
    <Handle
      type="source"
      :position="Position.Right"
      :id="p.id"
      :class="['cg-port', 'cg-port--' + p.type]"
      :style="handleStyle(p, i)"
      :title="`${p.label} (${typeLabel(p.type)})`"
    />
    <span class="cg-port-label cg-port-label--out" :style="{ top: top(i) + 'px', color: color(p.type) }">{{ p.label }}</span>
  </template>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { getInputPorts, getOutputPorts, PORT_TYPES } from '../../audio/graph/nodeTypes.js'

const props = defineProps({
  type: { type: String, required: true }
})

const inputs = computed(() => getInputPorts(props.type))
const outputs = computed(() => getOutputPorts(props.type))

const FIRST = 22
const GAP = 26
const top = (i) => FIRST + i * GAP
const color = (t) => PORT_TYPES[t]?.color || '#888'
const typeLabel = (t) => PORT_TYPES[t]?.label || t

const handleStyle = (p, i) => ({
  width: '12px',
  height: '12px',
  top: `${top(i)}px`,
  backgroundColor: color(p.type),
  border: '2px solid var(--background-light)'
})
</script>

<style>
/* Port names sit just above the line where the edge leaves/enters the
   handle (edges are horizontal there), on a small plate of the canvas
   color: an edge passing behind no longer runs through the text (Fase 5B). */
.cg-port-label {
  position: absolute;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
  transform: translateY(calc(-100% - 7px));
  padding: 1px 3px;
  border-radius: 3px;
  background: var(--background-dark);
  z-index: 1;
}
.cg-port-label--in { right: calc(100% + 2px); }
.cg-port-label--out { left: calc(100% + 2px); }
</style>
