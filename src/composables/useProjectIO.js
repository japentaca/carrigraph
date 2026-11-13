/**
 * useProjectIO — Import/export de proyectos en formato .cgproj
 *
 * Formato .cgproj (JSON):
 * {
 *   format: "cgproj",
 *   version: "1.0",
 *   app: "Carrigraph",
 *   metadata: { name, created, exported, nodeCount, edgeCount, schemaVersion },
 *   nodes: [...],
 *   edges: [...]
 * }
 *
 * `metadata.schemaVersion` (Fase 3A) is the graph schema (see
 * src/audio/graph/migrate.js). Files without it are migrated on import.
 */

import { migrateProject, CURRENT_SCHEMA_VERSION } from '../audio/graph/migrate.js'

const FORMAT_VERSION = '1.0'
const FILE_EXTENSION = '.cgproj'

/**
 * Exporta el proyecto actual como archivo .cgproj.
 * Dispara la descarga en el navegador.
 *
 * @param {Object} project - { name, nodes, edges, createdAt, settings? }
 */
export function exportProject(project) {
  const data = {
    format: 'cgproj',
    version: FORMAT_VERSION,
    app: 'Carrigraph',
    metadata: {
      name: project.name || 'Proyecto sin título',
      created: project.createdAt || new Date().toISOString(),
      exported: new Date().toISOString(),
      nodeCount: (project.nodes || []).length,
      edgeCount: (project.edges || []).length,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      // Transport settings (Fase 4A), restored on import
      ...(project.settings ? { tempo: project.settings.tempo, swing: project.settings.swing } : {})
    },
    nodes: (project.nodes || []).map(stripReactive),
    edges: (project.edges || []).map(stripReactive)
  }

  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/cgproj+json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${sanitizeFilename(data.metadata.name)}${FILE_EXTENSION}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  return data
}

/**
 * Abre el file picker nativo y devuelve el contenido parseado de un .cgproj.
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
export function importProjectFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.cgproj,.json'

    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (!file) {
        resolve({ success: false, error: 'No se seleccionó ningún archivo' })
        return
      }

      try {
        const text = await file.text()
        const data = JSON.parse(text)

        const result = validateProjectData(data)
        if (!result.valid) {
          resolve({ success: false, error: result.error })
          return
        }

        resolve({ success: true, data: result.data })
      } catch (err) {
        resolve({ success: false, error: 'El archivo no es un JSON válido' })
      }
    }

    input.oncancel = () => {
      resolve({ success: false, error: 'Cancelado' })
    }

    input.click()
  })
}

/**
 * Valida y normaliza los datos de un .cgproj (y lo migra al esquema actual).
 * Exportada para tests.
 */
export function validateProjectData(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Formato inválido: no es un objeto JSON' }
  }

  // Soporta tanto .cgproj como .json antiguo
  const isLegacy = !data.format

  if (!isLegacy && data.format !== 'cgproj') {
    return { valid: false, error: `Formato desconocido: "${data.format}". Se esperaba "cgproj".` }
  }

  if (!Array.isArray(data.nodes)) {
    return { valid: false, error: 'El archivo no contiene nodos válidos' }
  }

  const edges = Array.isArray(data.edges) ? data.edges : []

  const name = data.metadata?.name
    || data.name
    || 'Proyecto importado'

  // Normalizar nodos: asegurar que cada nodo tenga id, type, position, data
  const nodes = data.nodes.map((node, i) => ({
    id: node.id || `imported-${i}-${Date.now()}`,
    type: node.type || 'pattern',
    position: node.position || { x: 100 + (i % 5) * 180, y: 100 + Math.floor(i / 5) * 180 },
    data: node.data || { label: node.type || 'Node' }
  }))

  // Normalizar edges
  const normalizedEdges = edges.map((edge, i) => ({
    id: edge.id || `imported-edge-${i}-${Date.now()}`,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || undefined,
    targetHandle: edge.targetHandle || undefined,
    ...(edge.style && typeof edge.style === 'object' ? { style: edge.style } : {})
  }))

  // Llevar al esquema actual (los .cgproj viejos no traen schemaVersion)
  const migrated = migrateProject({
    nodes,
    edges: normalizedEdges,
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {}
  })

  return {
    valid: true,
    data: {
      name,
      nodes: migrated.nodes,
      edges: migrated.edges,
      metadata: migrated.metadata
    }
  }
}

/**
 * Quita reactividad de Vue/Pinia (limpia proxies para serialización).
 */
function stripReactive(obj) {
  if (!obj || typeof obj !== 'object') return obj
  return JSON.parse(JSON.stringify(obj))
}

/**
 * Sanitiza un nombre para usarlo como filename.
 */
function sanitizeFilename(name) {
  return name
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100) || 'proyecto'
}
