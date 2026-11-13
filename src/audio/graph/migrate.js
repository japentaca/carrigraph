/**
 * migrate.js — project schema migrations (pure; no Vue, no Pinia).
 *
 * `metadata.schemaVersion`:
 *   1 (or missing): projects saved before Fase 3. Edges ignored direction
 *     and their handle ids ('pattern-output', 'voice-input', 'output', …) did
 *     not name typed ports. Pattern nodes could lack a seed.
 *   2: typed, directed ports (src/audio/graph/nodeTypes.js); every Pattern
 *     node has a seed.
 *   3 (Fase 3B): Output nodes are mixer strips ({ volume, pan, mute, solo });
 *     Effects nodes exist; Voice nodes no longer carry the never-functional
 *     `effects` list (it is dropped: those effects never sounded, so keeping
 *     the sound of old projects means not turning them on now).
 *
 * migrateProject(project) returns a NEW object (deep copy) at
 * CURRENT_SCHEMA_VERSION; the input is not modified. Unknown fields are kept.
 * It does not add nodes: a migrated project without an Output node still
 * compiles in compatibility mode and sounds as before.
 */

import { resolvePorts } from './connections.js'
import { nodeSeed, edgeStyleFor, outputDefaults } from './nodeTypes.js'

export const CURRENT_SCHEMA_VERSION = 3

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const deepClone = (v) => JSON.parse(JSON.stringify(v ?? null))
const key = (id) => String(id)

export function getSchemaVersion(project) {
  const v = Number(project?.metadata?.schemaVersion)
  return Number.isInteger(v) && v > 0 ? v : 1
}

export function needsMigration(project) {
  return getSchemaVersion(project) < CURRENT_SCHEMA_VERSION
}

/**
 * @param {{ nodes?, edges?, metadata?, ... }} project
 * @returns {object} migrated copy with metadata.schemaVersion set
 */
export function migrateProject(project) {
  const p = isPlainObject(project) ? deepClone(project) : {}
  p.nodes = Array.isArray(p.nodes) ? p.nodes : []
  p.edges = Array.isArray(p.edges) ? p.edges : []
  p.metadata = isPlainObject(p.metadata) ? p.metadata : {}
  let version = getSchemaVersion(p)
  if (version < 2) {
    const g = migrateV1toV2(p.nodes, p.edges)
    p.nodes = g.nodes
    p.edges = g.edges
    version = 2
  }
  if (version < 3) {
    p.nodes = migrateV2toV3(p.nodes)
    version = 3
  }
  p.metadata.schemaVersion = Math.max(version, CURRENT_SCHEMA_VERSION)
  return p
}

/**
 * v1 → v2 on a graph:
 *  - nodes: `data` always an object; Pattern nodes get a deterministic seed
 *    (derived from the id) when theirs is missing or not a number.
 *  - edges: dropped if they point to a node that does not exist or are exact
 *    duplicates. Otherwise oriented and assigned typed ports: first as stored,
 *    else reversed (old presets connected Voice → Pattern). Edges that fit no
 *    port either way are kept with their handles cleared (they never had an
 *    effect; the compiler reports them in tracks mode).
 */
export function migrateV1toV2(nodes = [], edges = []) {
  const outNodes = nodes.map(n => {
    if (!isPlainObject(n)) return n
    const data = isPlainObject(n.data) ? { ...n.data } : {}
    if (n.type === 'pattern') data.seed = nodeSeed({ id: n.id, data })
    return { ...n, data }
  })
  const byId = new Map(outNodes.filter(n => n && n.id != null).map(n => [key(n.id), n]))

  const seen = new Set()
  const outEdges = []
  for (const e of edges) {
    if (!isPlainObject(e)) continue
    const s = byId.get(key(e.source))
    const t = byId.get(key(e.target))
    if (!s || !t) continue
    let edge = { ...e }
    const forward = resolvePorts(s, t, e.sourceHandle, e.targetHandle)
    const reverse = forward ? null : resolvePorts(t, s, null, null)
    if (forward) {
      edge = { ...edge, sourceHandle: forward.sourcePort.id, targetHandle: forward.targetPort.id, style: edgeStyleFor(forward.sourcePort.type) }
    } else if (reverse) {
      edge = {
        ...edge,
        source: e.target,
        target: e.source,
        sourceHandle: reverse.sourcePort.id,
        targetHandle: reverse.targetPort.id,
        style: edgeStyleFor(reverse.sourcePort.type)
      }
    } else {
      // Fits no port: keep it (it never had an effect) without the old
      // handle ids, which no longer exist on the nodes.
      edge = { ...edge, sourceHandle: null, targetHandle: null }
    }
    if (!edge.style) delete edge.style
    const sig = `${key(edge.source)}|${edge.sourceHandle ?? ''}|${key(edge.target)}|${edge.targetHandle ?? ''}`
    if (seen.has(sig)) continue
    seen.add(sig)
    outEdges.push(edge)
  }
  return { nodes: outNodes, edges: outEdges }
}

/**
 * v2 → v3 on the nodes:
 *  - Output nodes get the mixer defaults for the fields they lack
 *    (volume 1, pan 0, mute/solo off): same sound as before.
 *  - Voice nodes lose `data.effects` (the old disabled "próximamente"
 *    buttons; never audible). Real effects are Effects nodes now.
 */
export function migrateV2toV3(nodes = []) {
  return nodes.map(n => {
    if (!isPlainObject(n)) return n
    const data = isPlainObject(n.data) ? { ...n.data } : {}
    if (n.type === 'output') return { ...n, data: { ...outputDefaults(), ...data } }
    if (n.type === 'voice' && 'effects' in data) {
      delete data.effects
      return { ...n, data }
    }
    return isPlainObject(n.data) ? n : { ...n, data }
  })
}
