/**
 * palette.js — pure helpers of the searchable node palette (Fase 4B):
 * filtering by text and, when a connection is dropped on empty canvas, the
 * node types (and their port) that can take that connection.
 */

import { NODE_TYPES, NODE_TYPE_ORDER, canConnectTypes } from '../audio/graph/nodeTypes.js'

/** Lower case, without accents, trimmed. */
export const normalizeText = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim()

/** Extra words each type can be found by (Spanish and English). */
const KEYWORDS = {
  pattern: 'patron generador ritmo euclideo euclidean random aleatorio celular ruido pattern generator',
  steps: 'pasos grilla dibujar manual step sequencer',
  length: 'largo longitud pasos length pattern length',
  loop: 'loop celda repetir tamaño tamano size',
  logic: 'logica and or xor not combinar',
  transform: 'transformar invertir reversa rotar velocidad probabilidad',
  scale: 'escala melodia notas tonica scale melody',
  chord: 'acorde triada septima quintas chord',
  groove: 'groove swing humanizar acento',
  voice: 'voz instrumento piano synth bajo bass guitarra drums bateria voice selector',
  effects: 'efectos reverb delay filtro distorsion fx',
  output: 'salida mezcla pista output mixer volumen'
}

/**
 * Palette entries matching a query, best first. Every word of the query must
 * appear in the label, the description, the type or the keywords; matches at
 * the start of the label rank first. Empty query → all, in palette order.
 * @param {{ type, label, description }[]} entries
 */
export function searchPalette(entries = [], query = '') {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (!words.length) return entries.slice()
  const scored = []
  entries.forEach((entry, index) => {
    const label = normalizeText(entry.label)
    const hay = `${label} ${normalizeText(entry.description)} ${entry.type} ${KEYWORDS[entry.type] || ''}`
    if (!words.every(w => hay.includes(w))) return
    let score = 0
    if (label.startsWith(words[0])) score += 3
    else if (label.split(/\s+/).some(part => part.startsWith(words[0]))) score += 2
    else if (label.includes(words[0])) score += 1
    scored.push({ entry, score, index })
  })
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(s => s.entry)
}

/**
 * Node types that can take a connection dragged from a port and dropped on
 * empty canvas, with the port of the new node to connect.
 * @param {{ type: string, handleType: 'source'|'target' }} from
 *   type: the port type (pattern, notes…); handleType: 'source' when the drag
 *   started on an output (the new node needs a compatible input), 'target'
 *   when it started on an input (the new node needs a compatible output).
 * @returns {{ type: string, port: { id, type, label } }[]} in palette order
 */
export function compatibleNodeTypes({ type, handleType }) {
  const out = []
  for (const t of NODE_TYPE_ORDER) {
    const def = NODE_TYPES[t]
    const ports = handleType === 'source' ? def.inputs : def.outputs
    const port = handleType === 'source'
      ? ports.find(p => canConnectTypes(type, p.type))
      : ports.find(p => canConnectTypes(p.type, type))
    if (port) out.push({ type: t, port })
  }
  return out
}

/**
 * Where the new node goes when created from a dropped connection: an output
 * dragged to the right gets a node whose input is at the drop point (its left
 * edge there); an input dragged to the left gets a node to the left of it.
 */
export function nodePositionForDrop(point, handleType, { width = 220, portOffsetY = 22 } = {}) {
  const y = Math.round(point.y - portOffsetY)
  return handleType === 'source'
    ? { x: Math.round(point.x), y }
    : { x: Math.round(point.x - width), y }
}
