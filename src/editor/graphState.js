/**
 * graphState.js — pure helpers about the editor graph as it is persisted
 * (Fase 4A). No Vue / Pinia.
 *
 * Vue Flow writes its internal node/edge objects back into the store
 * (v-model): nodes carry `computedPosition`, `dimensions`, `handleBounds`,
 * `selected`…, and edges carry their whole `sourceNode`/`targetNode`. None of
 * that belongs in a save, an undo snapshot or the "unsaved changes" check.
 */

const NODE_INTERNALS = [
  'computedPosition', 'dimensions', 'handleBounds', 'selected', 'dragging', 'resizing',
  'initialized', 'isParent', 'events', 'draggable', 'selectable', 'connectable', 'focusable'
]

const EDGE_INTERNALS = [
  'sourceNode', 'targetNode', 'events', 'selected', 'sourceX', 'sourceY', 'targetX', 'targetY',
  'interactionWidth', 'updatable', 'selectable', 'focusable'
]

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

function strip(obj, keys) {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) {
    if (keys.includes(k) || v === undefined) continue
    out[k] = clone(v)
  }
  return out
}

/** Plain, deep-copied node without Vue Flow's runtime fields. */
export function persistedNode(node) {
  return strip(node, NODE_INTERNALS)
}

/** Plain, deep-copied edge without Vue Flow's runtime fields (no sourceNode/targetNode). */
export function persistedEdge(edge) {
  return strip(edge, EDGE_INTERNALS)
}

export function persistedGraph(nodes = [], edges = []) {
  return { nodes: (nodes || []).map(persistedNode), edges: (edges || []).map(persistedEdge) }
}

/** Transport settings saved with a project (metadata.tempo / metadata.swing). */
export const DEFAULT_SETTINGS = Object.freeze({ tempo: 120, swing: 0 })

/** Settings of a loaded project (missing or invalid values → defaults). */
export function settingsFromMetadata(metadata = {}) {
  const tempo = Number(metadata?.tempo)
  const swing = Number(metadata?.swing)
  return {
    tempo: Number.isFinite(tempo) && tempo > 0 ? Math.min(200, Math.max(60, Math.round(tempo))) : DEFAULT_SETTINGS.tempo,
    swing: Number.isFinite(swing) ? Math.min(1, Math.max(0, swing)) : DEFAULT_SETTINGS.swing
  }
}

/**
 * What decides "unsaved changes": node id/type/position/data, edge
 * id/ends/handles, and the transport settings. Selection, sizes and other
 * runtime state do not count.
 */
export function graphSignature(nodes = [], edges = [], settings = DEFAULT_SETTINGS) {
  return JSON.stringify({
    n: (nodes || []).map(n => [String(n.id), n.type ?? null, n.position?.x ?? 0, n.position?.y ?? 0, n.data ?? {}]),
    e: (edges || []).map(e => [String(e.id), String(e.source), String(e.target), e.sourceHandle ?? null, e.targetHandle ?? null]),
    s: [Number(settings?.tempo) || DEFAULT_SETTINGS.tempo, Number(settings?.swing) || 0]
  })
}

/** Keys whose values differ between two data objects (sorted). */
export function changedKeys(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  return [...keys]
    .filter(k => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
    .sort()
}
