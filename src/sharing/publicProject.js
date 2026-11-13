/**
 * publicProject.js — what a project looks like when it is shown to people
 * other than its owner (shared link, gallery). Pure: no Vue, no Pinia, no
 * Node APIs. Used by the server (server/routes/public.js) to build the public
 * response, and by the browser (shared view) to check it again before
 * drawing or playing anything (Fase 5A).
 *
 * Steps: shape check of the stored graph → migrateProject (old schemas are
 * brought to the current one, like when the owner opens it) → shape check
 * again → whitelist of fields. Only the graph, name, description, tempo,
 * swing and schema version leave the server: no ids of users, no emails, no
 * internal metadata (created_by, last_modified_by, …).
 */

import { migrateProject } from '../audio/graph/migrate.js'
import { validateGraph } from '../audio/graph/validateGraph.js'
import { compileGraph } from '../audio/graph/compile.js'
import { settingsFromMetadata } from '../editor/graphState.js'

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/

/** Node fields that are shown publicly. */
function publicNode(node) {
  const out = { id: node.id, type: typeof node.type === 'string' ? node.type : 'default' }
  if (isPlainObject(node.position)) out.position = { x: node.position.x, y: node.position.y }
  out.data = isPlainObject(node.data) ? node.data : {}
  return out
}

/** Edge fields that are shown publicly (style only as a stroke color). */
function publicEdge(edge, index) {
  const out = {
    id: typeof edge.id === 'string' || typeof edge.id === 'number' ? edge.id : `e${index}`,
    source: edge.source,
    target: edge.target,
    sourceHandle: typeof edge.sourceHandle === 'string' ? edge.sourceHandle : null,
    targetHandle: typeof edge.targetHandle === 'string' ? edge.targetHandle : null
  }
  const stroke = edge.style?.stroke
  if (typeof stroke === 'string' && HEX_COLOR.test(stroke)) out.style = { stroke, strokeWidth: 2 }
  return out
}

/** Number of tracks the graph plays (null if it cannot be compiled). */
export function countTracks(nodes, edges) {
  try {
    return compileGraph(nodes, edges, { tempo: 120 }).score.tracks.length
  } catch {
    return null
  }
}

/**
 * Stored project ({ nodes, edges, metadata, ... }) → public graph.
 * @returns {{ ok: true, graph: { nodes, edges, metadata: { schemaVersion, tempo, swing } } }
 *          | { ok: false, error: string }}
 */
export function toPublicGraph(project) {
  const nodes = project?.nodes
  const edges = project?.edges
  const before = validateGraph(nodes, edges)
  if (before) return { ok: false, error: before }

  const migrated = migrateProject({
    nodes, edges, metadata: isPlainObject(project?.metadata) ? project.metadata : {}
  })
  const after = validateGraph(migrated.nodes, migrated.edges)
  if (after) return { ok: false, error: after }

  const settings = settingsFromMetadata(migrated.metadata)
  return {
    ok: true,
    graph: {
      nodes: migrated.nodes.map(publicNode),
      edges: migrated.edges.map(publicEdge),
      metadata: {
        schemaVersion: migrated.metadata.schemaVersion,
        tempo: settings.tempo,
        swing: settings.swing
      }
    }
  }
}

/**
 * Browser side: payload of GET /api/shared/:token or /api/gallery/:id →
 * project ready to draw and play (migrated and checked again; the server
 * did it already, but nothing from the network is trusted blindly).
 * @returns {{ ok: true, project } | { ok: false, error }}
 */
export function preparePublicProject(payload) {
  const p = payload?.project
  if (!isPlainObject(p)) return { ok: false, error: 'Respuesta inválida del servidor' }
  const result = toPublicGraph(p)
  if (!result.ok) return { ok: false, error: `El proyecto tiene un formato inválido (${result.error})` }
  return {
    ok: true,
    project: {
      name: typeof p.name === 'string' ? p.name : 'Proyecto',
      description: typeof p.description === 'string' ? p.description : '',
      updated_at: p.updated_at ?? null,
      ...result.graph,
      settings: settingsFromMetadata(result.graph.metadata)
    },
    author: typeof payload.author?.name === 'string' ? payload.author.name : '',
    id: payload.id ?? null
  }
}
