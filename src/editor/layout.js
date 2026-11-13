/**
 * layout.js — "Auto Layout" (Fase 4A). Pure: no Vue.
 *
 * Layered layout following the signal: each node goes to the column of its
 * longest path from a source (Pattern → … → Voice → Effects → Output reads
 * left to right). Inside a column nodes are ordered by the average row of
 * their inputs (fewer crossings), then by their current y. Heights come from
 * Vue Flow's measured `dimensions` when present.
 */

const DEFAULTS = { x: 80, y: 80, gapX: 80, gapY: 40, width: 260, height: 180 }

/**
 * @param {object[]} nodes  { id, position, dimensions? }
 * @param {object[]} edges  { source, target }
 * @returns {Record<string, { x: number, y: number }>} new position per node id
 */
export function autoLayoutPositions(nodes = [], edges = [], options = {}) {
  const o = { ...DEFAULTS, ...options }
  const ids = nodes.map(n => String(n.id))
  const idSet = new Set(ids)
  const inputs = new Map(ids.map(id => [id, []]))
  for (const e of edges || []) {
    const s = String(e.source)
    const t = String(e.target)
    if (idSet.has(s) && idSet.has(t) && s !== t) inputs.get(t).push(s)
  }

  // Longest path from a source (graphs are acyclic; guarded anyway)
  const depth = new Map()
  const visiting = new Set()
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id)
    if (visiting.has(id)) return 0
    visiting.add(id)
    const d = inputs.get(id).reduce((max, src) => Math.max(max, depthOf(src) + 1), 0)
    visiting.delete(id)
    depth.set(id, d)
    return d
  }
  ids.forEach(depthOf)

  const byId = new Map(nodes.map(n => [String(n.id), n]))
  const size = (id) => {
    const d = byId.get(id)?.dimensions
    return {
      width: d?.width > 0 ? d.width : o.width,
      height: d?.height > 0 ? d.height : o.height
    }
  }

  const columns = []
  for (const id of ids) {
    const d = depth.get(id)
    ;(columns[d] ||= []).push(id)
  }

  const rowIndex = new Map()
  const positions = {}
  let x = o.x
  for (const column of columns) {
    if (!column) continue
    const key = (id) => {
      const ins = inputs.get(id).filter(src => rowIndex.has(src))
      const bary = ins.length ? ins.reduce((s, src) => s + rowIndex.get(src), 0) / ins.length : Infinity
      return [bary, byId.get(id)?.position?.y ?? 0]
    }
    column.sort((a, b) => {
      const [ba, ya] = key(a)
      const [bb, yb] = key(b)
      if (ba !== bb) return ba === Infinity ? 1 : bb === Infinity ? -1 : ba - bb
      return ya - yb
    })
    let y = o.y
    let widest = 0
    column.forEach((id, i) => {
      const { width, height } = size(id)
      positions[id] = { x, y }
      rowIndex.set(id, i)
      y += height + o.gapY
      widest = Math.max(widest, width)
    })
    x += widest + o.gapX
  }
  return positions
}
