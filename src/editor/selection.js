/**
 * selection.js — pure helpers for group operations on the canvas (Fase 4B):
 * copy / paste / duplicate a set of nodes with their internal edges, and
 * align / distribute. No Vue: the editor (useEditorNodes) applies the result
 * to the store in a single undo entry.
 */

import { persistedNode, persistedEdge } from './graphState.js'
import { nodeSeed, newNodeId } from '../audio/graph/nodeTypes.js'
import { SEED_TYPES } from '../audio/graph/nodeParams.js'

const key = (id) => String(id)
const deepClone = (v) => JSON.parse(JSON.stringify(v ?? null))

/** Default size of a node whose dimensions are not measured yet. */
export const DEFAULT_NODE_SIZE = { width: 220, height: 120 }

/** Measured size of a node (Vue Flow `dimensions`), or the default. */
export function nodeSize(node) {
  const d = node?.dimensions
  return {
    width: d?.width > 0 ? d.width : DEFAULT_NODE_SIZE.width,
    height: d?.height > 0 ? d.height : DEFAULT_NODE_SIZE.height
  }
}

/** Bounding box { x, y, width, height } of some nodes (null if none). */
export function boundsOf(nodes = []) {
  if (!nodes.length) return null
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const n of nodes) {
    const { width, height } = nodeSize(n)
    const x = n.position?.x ?? 0
    const y = n.position?.y ?? 0
    x1 = Math.min(x1, x); y1 = Math.min(y1, y)
    x2 = Math.max(x2, x + width); y2 = Math.max(y2, y + height)
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

/**
 * Copy of a set of nodes and of the edges between them (edges to nodes
 * outside the set are left out). Plain data, without Vue Flow runtime fields.
 * Seeds are made explicit: a node without a stored seed uses one derived from
 * its id, which would change with the new id of the pasted copy — so the
 * copy stores the seed it was really using (it sounds the same).
 * @returns {{ nodes: object[], edges: object[] } | null}
 */
export function copySubgraph(nodes = [], edges = [], ids = []) {
  const wanted = new Set(ids.map(key))
  const picked = nodes.filter(n => wanted.has(key(n.id)))
  if (!picked.length) return null
  const copiedNodes = picked.map(n => {
    const copy = deepClone(persistedNode(n))
    if (SEED_TYPES.includes(n.type)) {
      copy.data = { ...(copy.data || {}), seed: nodeSeed(n) }
    }
    // Keep the measured size so a paste can be placed / aligned right away.
    if (n.dimensions?.width) copy.size = { width: n.dimensions.width, height: n.dimensions.height }
    return copy
  })
  const copiedEdges = edges
    .filter(e => wanted.has(key(e.source)) && wanted.has(key(e.target)))
    .map(e => deepClone(persistedEdge(e)))
  return { nodes: copiedNodes, edges: copiedEdges }
}

let edgeCounter = 0
const defaultEdgeId = () => `edge-${Date.now()}-${(edgeCounter++).toString(36)}-${Math.random().toString(36).slice(2, 5)}`

/**
 * New nodes and edges from a copied subgraph: fresh ids (edges remapped to
 * them), seeds and data kept, positions moved.
 * @param {{ nodes, edges }} clip  from copySubgraph
 * @param {object} [opts]
 * @param {{x:number,y:number}} [opts.offset]  added to every position, or
 * @param {{x:number,y:number}} [opts.at]      where the top-left corner of the group goes
 * @param {(node) => string} [opts.nodeId]
 * @param {() => string} [opts.edgeId]
 * @returns {{ nodes: object[], edges: object[], idMap: Record<string,string> }}
 */
export function pasteSubgraph(clip, { offset, at, nodeId = (n) => newNodeId(n.type), edgeId = defaultEdgeId } = {}) {
  if (!clip?.nodes?.length) return { nodes: [], edges: [], idMap: {} }
  const box = boundsOf(clip.nodes.map(n => ({ ...n, dimensions: n.size })))
  const shift = at
    ? { x: Math.round(at.x - box.x), y: Math.round(at.y - box.y) }
    : { x: offset?.x ?? 40, y: offset?.y ?? 40 }
  const idMap = {}
  const nodes = clip.nodes.map(n => {
    const id = nodeId(n)
    idMap[key(n.id)] = id
    const { size, ...rest } = deepClone(n)
    return {
      ...rest,
      id,
      position: { x: (n.position?.x ?? 0) + shift.x, y: (n.position?.y ?? 0) + shift.y }
    }
  })
  const edges = clip.edges
    .filter(e => idMap[key(e.source)] && idMap[key(e.target)])
    .map(e => ({ ...deepClone(e), id: edgeId(), source: idMap[key(e.source)], target: idMap[key(e.target)] }))
  return { nodes, edges, idMap }
}

export const ALIGN_MODES = ['left', 'center', 'right', 'top', 'middle', 'bottom', 'distribute-h', 'distribute-v']

/**
 * New positions to align or distribute some nodes (by their measured size).
 *   left / center / right    same x of the left edge / center / right edge
 *   top / middle / bottom    same y of the top edge / center / bottom edge
 *   distribute-h / -v        equal gaps between neighbours, the extremes stay
 * @returns {Record<string, {x:number,y:number}>} only nodes that move
 */
export function alignPositions(nodes = [], ids = [], mode = 'left') {
  const wanted = new Set(ids.map(key))
  const items = nodes.filter(n => wanted.has(key(n.id))).map(n => ({
    id: key(n.id), x: n.position?.x ?? 0, y: n.position?.y ?? 0, ...nodeSize(n)
  }))
  const out = {}
  if (items.length < 2) return out
  const put = (it, x, y) => {
    x = Math.round(x); y = Math.round(y)
    if (x !== it.x || y !== it.y) out[it.id] = { x, y }
  }
  const minX = Math.min(...items.map(i => i.x))
  const maxR = Math.max(...items.map(i => i.x + i.width))
  const minY = Math.min(...items.map(i => i.y))
  const maxB = Math.max(...items.map(i => i.y + i.height))
  switch (mode) {
    case 'left': items.forEach(i => put(i, minX, i.y)); break
    case 'right': items.forEach(i => put(i, maxR - i.width, i.y)); break
    case 'center': { const c = (minX + maxR) / 2; items.forEach(i => put(i, c - i.width / 2, i.y)); break }
    case 'top': items.forEach(i => put(i, i.x, minY)); break
    case 'bottom': items.forEach(i => put(i, i.x, maxB - i.height)); break
    case 'middle': { const c = (minY + maxB) / 2; items.forEach(i => put(i, i.x, c - i.height / 2)); break }
    case 'distribute-h':
    case 'distribute-v': {
      if (items.length < 3) break
      const horizontal = mode === 'distribute-h'
      const pos = horizontal ? 'x' : 'y'
      const size = horizontal ? 'width' : 'height'
      const sorted = items.slice().sort((a, b) => a[pos] - b[pos])
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const total = sorted.reduce((s, i) => s + i[size], 0)
      const span = last[pos] + last[size] - first[pos]
      const gap = (span - total) / (sorted.length - 1)
      let cursor = first[pos]
      for (const it of sorted) {
        if (horizontal) put(it, cursor, it.y)
        else put(it, it.x, cursor)
        cursor += it[size] + gap
      }
      break
    }
    default: break
  }
  return out
}
