/**
 * nodeRegistry.js — the single registry of node types for the UI (Fase 4A).
 *
 * Everything about a node type comes from here: palette entry (label, icon,
 * color, description), typed ports, default data, and the Vue component that
 * draws it. The palette (AppSidebar), the canvas context menu, the node
 * templates of the canvas, the edit modal and new-node creation all read it.
 *
 * The pure part (no Vue: ports, defaults, palette data) stays in
 * src/audio/graph/nodeTypes.js because the compiler and the migration use it
 * outside the browser; this file only adds the component on top. To add a
 * node type: NODE_TYPES + NODE_TYPE_ORDER (nodeTypes.js), its component in
 * COMPONENTS below, and its evaluator in compile.js.
 */

import {
  NODE_TYPES, NODE_TYPE_ORDER, createNode, createNodeData, edgeStyleFor,
  getInputPorts, getOutputPorts, nodeLabel
} from '../../audio/graph/nodeTypes.js'
import PatternNode from './PatternNode.vue'
import LengthNode from './LengthNode.vue'
import LoopNode from './LoopNode.vue'
import VoiceNode from './VoiceNode.vue'
import ScaleNode from './ScaleNode.vue'
import LogicNode from './LogicNode.vue'
import TransformNode from './TransformNode.vue'
import GrooveNode from './GrooveNode.vue'
import ChordNode from './ChordNode.vue'
import StepPatternNode from './StepPatternNode.vue'
import OutputNode from './OutputNode.vue'
import EffectsNode from './EffectsNode.vue'

const COMPONENTS = {
  pattern: PatternNode,
  steps: StepPatternNode,
  length: LengthNode,
  loop: LoopNode,
  logic: LogicNode,
  transform: TransformNode,
  scale: ScaleNode,
  chord: ChordNode,
  groove: GrooveNode,
  voice: VoiceNode,
  effects: EffectsNode,
  output: OutputNode
}

/**
 * Every node type in palette order:
 * { type, label, description, icon, color, inputs, outputs, defaults, component }
 */
export const NODE_REGISTRY = Object.freeze(NODE_TYPE_ORDER.map(type => Object.freeze({
  type,
  ...NODE_TYPES[type],
  component: COMPONENTS[type]
})))

const byType = Object.fromEntries(NODE_REGISTRY.map(entry => [entry.type, entry]))

/** dataTransfer type of a palette drag (the canvas creates the node on drop). */
export const NODE_DRAG_TYPE = 'application/x-carrigraph-node'

/** Registered type keys, in palette order (one canvas template per type). */
export const nodeTypeKeys = NODE_REGISTRY.map(entry => entry.type)

/** { [type]: component } (kept for code that wants the plain map). */
export const NODE_COMPONENTS = Object.freeze({ ...COMPONENTS })

export function getNodeEntry(type) {
  return byType[type] || null
}

export function getNodeComponent(type) {
  return byType[type]?.component || null
}

/** Display name of a node: its own label, or the label of its type. */
export function nodeDisplayName(node) {
  return nodeLabel(node)
}

/** Palette entries ({ type, label, description, icon, color }) in order. */
export function paletteEntries() {
  return NODE_REGISTRY.map(({ type, label, description, icon, color }) => ({ type, label, description, icon, color }))
}

export { createNode, createNodeData, edgeStyleFor, getInputPorts, getOutputPorts }
