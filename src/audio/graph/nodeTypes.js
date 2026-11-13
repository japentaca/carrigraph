/**
 * nodeTypes.js — single pure definition of every node type: palette entry
 * (label, icon, color, description), typed ports and default data.
 * No Vue, no Pinia: the compiler, the migration, the palette, the context
 * menu and the port handles all read from here. (Fase 4's nodeRegistry can
 * add the Vue component on top of this.)
 *
 * Port types:
 *   pattern  rhythm only: { kind:'pattern', length, steps: boolean[], seed }
 *   number   a number (Length, Loop)
 *   notes    rhythm + pitch/time/velocity: { kind:'notes', length, events, scale, seed }
 *   audio    a voice with its notes and effects, ready to become a track (Voice → [Effects…] → Output)
 *
 * Compatibility: same type, or pattern → notes (a pattern is "notes without
 * pitches"; the voice picks them with its fallback melody, or a Scale does).
 */

import { EFFECT_DEFAULTS } from '../engine/effects.js'

export const PORT_TYPES = {
  pattern: { label: 'Patrón', color: '#f59e0b' },
  number: { label: 'Número', color: '#10b981' },
  notes: { label: 'Notas', color: '#ec4899' },
  audio: { label: 'Audio', color: '#8b5cf6' }
}

/** Can an output of type `from` feed an input of type `to`? */
export function canConnectTypes(from, to) {
  if (!PORT_TYPES[from] || !PORT_TYPES[to]) return false
  return from === to || (from === 'pattern' && to === 'notes')
}

/** Deterministic seed in [0, 1) derived from a string (e.g. a node id). */
export function seedFromId(id) {
  let h = 2166136261 >>> 0
  const str = String(id ?? '')
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995) >>> 0
  return Math.round(((h >>> 0) / 4294967296) * 1000) / 1000
}

/** A fresh seed for a new node (3 decimals, as the Pattern node shows it ×1000). */
export function newSeed() {
  return Math.round(Math.random() * 1000) / 1000
}

/** Seed of a node: its stored value if it is a finite number (0 included), else derived from its id. */
export function nodeSeed(node) {
  const s = node?.data?.seed
  if (s !== null && s !== '' && s !== undefined && Number.isFinite(Number(s))) return Number(s)
  return seedFromId(node?.id)
}

const port = (id, type, label) => ({ id, type, label })

/**
 * Effects node data: one block per effect (fixed order distortion → filter →
 * delay → reverb), each with `enabled` and its parameters (engine/effects.js).
 * A new node starts with a soft reverb on.
 */
export function effectsDefaults() {
  return {
    distortion: { enabled: false, ...EFFECT_DEFAULTS.distortion },
    filter: { enabled: false, ...EFFECT_DEFAULTS.filter },
    delay: { enabled: false, ...EFFECT_DEFAULTS.delay },
    reverb: { enabled: true, ...EFFECT_DEFAULTS.reverb }
  }
}

/** Output (mixer strip) data: volume multiplies the voice volume; pan adds. */
export function outputDefaults() {
  return { volume: 1, pan: 0, mute: false, solo: false }
}

export const NODE_TYPES = {
  pattern: {
    label: 'Generador de patrones',
    description: 'Genera patrones rítmicos',
    icon: '🎵',
    color: '#3b82f6',
    inputs: [port('length', 'number', 'Largo'), port('loop', 'number', 'Loop')],
    outputs: [port('pattern', 'pattern', 'Patrón')],
    defaults: () => ({
      algorithm: 'euclidean', density: 0.5, rotation: 0, seed: newSeed(),
      rule: 30, generations: 7, noiseScale: 4
    })
  },
  steps: {
    label: 'Patrón por pasos',
    description: 'Patrón dibujado a mano en una grilla',
    icon: '▦',
    color: '#0ea5e9',
    inputs: [],
    outputs: [port('pattern', 'pattern', 'Patrón')],
    defaults: () => ({ steps: Array.from({ length: 16 }, (_, i) => i % 4 === 0) })
  },
  length: {
    label: 'Largo del patrón',
    description: 'Largo del patrón (4-512)',
    icon: '📏',
    color: '#10b981',
    inputs: [],
    outputs: [port('value', 'number', 'Largo')],
    defaults: () => ({ value: 16, min: 4, max: 512 })
  },
  loop: {
    label: 'Tamaño de loop',
    description: 'Celda que se repite (1-64)',
    icon: '🔄',
    color: '#f59e0b',
    inputs: [],
    outputs: [port('value', 'number', 'Loop')],
    defaults: () => ({ value: 8, min: 1, max: 64 })
  },
  logic: {
    label: 'Lógica de patrones',
    description: 'Combina dos patrones: AND, OR, XOR, NOT',
    icon: '⊕',
    color: '#d97706',
    inputs: [port('a', 'pattern', 'A'), port('b', 'pattern', 'B')],
    outputs: [port('pattern', 'pattern', 'Patrón')],
    defaults: () => ({ operation: 'and' })
  },
  transform: {
    label: 'Transformar',
    description: 'Invertir, reversa, rotar, velocidad, probabilidad',
    icon: '🔀',
    color: '#b45309',
    inputs: [port('in', 'pattern', 'Entrada')],
    outputs: [port('pattern', 'pattern', 'Patrón')],
    defaults: () => ({ operation: 'reverse', amount: 1, probability: 0.75, seed: newSeed() })
  },
  scale: {
    label: 'Escala / Melodía',
    description: 'Convierte un patrón en notas de una escala',
    icon: '🎼',
    color: '#db2777',
    inputs: [port('in', 'notes', 'Entrada')],
    outputs: [port('notes', 'notes', 'Notas')],
    defaults: () => ({ root: 'C', scale: 'pentatonic', mode: 'ascending', octave: 4, range: 2, seed: newSeed() })
  },
  chord: {
    label: 'Acorde',
    description: 'Convierte cada nota en un acorde de la escala',
    icon: '🎹',
    color: '#be185d',
    inputs: [port('in', 'notes', 'Notas')],
    outputs: [port('notes', 'notes', 'Notas')],
    defaults: () => ({ chord: 'triad' })
  },
  groove: {
    label: 'Groove',
    description: 'Swing, humanización y acentos',
    icon: '〰️',
    color: '#9d174d',
    inputs: [port('in', 'notes', 'Notas')],
    outputs: [port('notes', 'notes', 'Notas')],
    defaults: () => ({ swing: 0.3, timing: 0, velocity: 0.2, accentEvery: 4, accentAmount: 0.3, seed: newSeed() })
  },
  voice: {
    label: 'Voz',
    description: 'Instrumento que toca las notas',
    icon: '🎹',
    color: '#8b5cf6',
    inputs: [port('notes', 'notes', 'Notas')],
    outputs: [port('audio', 'audio', 'Audio')],
    defaults: () => ({
      instrument: 'Piano', volume: 0.7, pan: 0, octave: 4,
      // Fallback melody (used when no Scale node feeds the voice)
      melodyMode: 'ascending', root: 'C', scale: 'pentatonic', range: 2,
      drumPiece: 'auto'
    })
  },
  effects: {
    label: 'Efectos',
    description: 'Distorsión, filtro, delay y reverb de la pista',
    icon: '🌊',
    color: '#6d28d9',
    inputs: [port('in', 'audio', 'Audio')],
    outputs: [port('audio', 'audio', 'Audio')],
    defaults: () => effectsDefaults()
  },
  output: {
    label: 'Salida',
    description: 'Fin de una pista y su canal de mezcla',
    icon: '🔊',
    color: '#737373',
    inputs: [port('audio', 'audio', 'Audio')],
    outputs: [],
    defaults: () => outputDefaults()
  }
}

/**
 * English names the original node types had (Fase 5B translated them). New
 * nodes store the Spanish label in `data.label`; saved projects keep the old
 * one, and `nodeLabel` shows the current name instead of an unchanged
 * default. Types and stored data are not renamed.
 */
export const LEGACY_LABELS = {
  pattern: 'Pattern Generator',
  length: 'Pattern Length',
  loop: 'Loop Size',
  voice: 'Voice Selector'
}

/** Name to show for a node: its own label, unless it is an old default name. */
export function nodeLabel(node) {
  const own = node?.data?.label
  const type = NODE_TYPES[node?.type]
  if (own && !(type && LEGACY_LABELS[node.type] === own)) return own
  return type?.label || node?.type || 'Nodo'
}

/** Types in palette order. */
export const NODE_TYPE_ORDER = ['pattern', 'steps', 'length', 'loop', 'logic', 'transform', 'scale', 'chord', 'groove', 'voice', 'effects', 'output']

/** Node types that only work in chains ending in an Output (new in Fase 3). */
export const GRAPH_ONLY_TYPES = ['steps', 'logic', 'transform', 'scale', 'chord', 'groove', 'effects']

export function getInputPorts(type) {
  return NODE_TYPES[type]?.inputs || []
}

export function getOutputPorts(type) {
  return NODE_TYPES[type]?.outputs || []
}

/** Palette entries ({ type, label, description, icon, color }) in order. */
export function paletteEntries() {
  return NODE_TYPE_ORDER.map(type => {
    const t = NODE_TYPES[type]
    return { type, label: t.label, description: t.description, icon: t.icon, color: t.color }
  })
}

/** Full `data` for a new node of `type` (label, color and defaults; seeds assigned now). */
export function createNodeData(type) {
  const t = NODE_TYPES[type]
  if (!t) return {}
  return { label: t.label, color: t.color, ...t.defaults() }
}

/** Unique-enough id for a new node. */
export function newNodeId(type) {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

/** A new node object ready for the store. */
export function createNode(type, position = { x: 100, y: 100 }) {
  return { id: newNodeId(type), type, position: { ...position }, data: createNodeData(type) }
}

/** Edge appearance by port type (stroke color). */
export function edgeStyleFor(portType) {
  const color = PORT_TYPES[portType]?.color
  return color ? { stroke: color, strokeWidth: 2 } : undefined
}
