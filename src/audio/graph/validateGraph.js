/**
 * validateGraph.js — basic shape check of a saved graph (pure; no Vue, no
 * Pinia, no Node APIs). The server uses it on every create/save and on the
 * content it serves publicly (shared links, gallery); the shared view runs
 * the same check in the browser before drawing anything (Fase 5A).
 *
 * Nodes: objects with an `id` (non-empty string or finite number);
 * `position` (if present) with numeric x/y; `data` (if present) an object.
 * Edges: objects with `source` and `target`.
 */

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isValidId = (value) =>
  (typeof value === 'string' && value.length > 0) ||
  (typeof value === 'number' && Number.isFinite(value))

/** @returns {string|null} error message, or null when the shape is valid */
export function validateGraph(nodes, edges) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return 'Nodes and edges must be arrays'
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (!isPlainObject(node)) return `Invalid node at index ${i}: must be an object`
    if (!isValidId(node.id)) return `Invalid node at index ${i}: missing id`
    if (node.position !== undefined) {
      const p = node.position
      if (!isPlainObject(p) || typeof p.x !== 'number' || typeof p.y !== 'number') {
        return `Invalid node at index ${i}: position must have numeric x and y`
      }
    }
    if (node.data !== undefined && !isPlainObject(node.data)) {
      return `Invalid node at index ${i}: data must be an object`
    }
  }

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    if (!isPlainObject(edge)) return `Invalid edge at index ${i}: must be an object`
    if (!isValidId(edge.source) || !isValidId(edge.target)) {
      return `Invalid edge at index ${i}: source and target are required`
    }
  }

  return null
}

export default validateGraph
