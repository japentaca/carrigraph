/**
 * Public, read-only access to projects (Fase 5A).
 *
 *   GET  /api/shared/:token          project behind a share link (no auth)
 *   POST /api/shared/:token/copy     copy it into the caller's projects (auth)
 *   GET  /api/gallery?page=&limit=   public projects, paginated (no auth)
 *   GET  /api/gallery/:id            one public project (no auth)
 *   POST /api/gallery/:id/copy       copy it into the caller's projects (auth)
 *
 * Public responses carry only the graph (migrated to the current schema and
 * shape-checked, see src/sharing/publicProject.js), name, description,
 * tempo/swing and the owner's display name: never emails, user ids or
 * internal metadata. Shared links show the current version of the project.
 */

import express from 'express'
import { dbHelpers, withTransaction } from '../database.js'
import { toPublicGraph, countTracks } from '../../src/sharing/publicProject.js'

const router = express.Router()

/** Tokens are 32 base64url chars (generateShareToken); anything else is not looked up. */
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/

export const GALLERY_DEFAULT_LIMIT = 12
export const GALLERY_MAX_LIMIT = 48

const parseId = (value) => (/^\d+$/.test(String(value)) ? parseInt(value, 10) : NaN)

const authenticateJWT = (req, res, next) => req.app.locals.authenticateJWT(req, res, next)

const notFound = (res) => res.status(404).json({ message: 'Shared project not found' })

const serverError = (res, label, error) => {
  console.error(`${label} error:`, error)
  res.status(500).json({ message: 'Internal server error' })
}

// Track counts of gallery entries, by project id + updated_at (compiling a
// graph is cheap but the gallery is public; this keeps repeated pages cheap).
const trackCountCache = new Map()
const TRACK_CACHE_MAX = 500

function cachedTrackCount(row, graph) {
  const key = `${row.id}:${row.updated_at}`
  if (trackCountCache.has(key)) return trackCountCache.get(key)
  const count = countTracks(graph.nodes, graph.edges)
  if (trackCountCache.size >= TRACK_CACHE_MAX) {
    trackCountCache.delete(trackCountCache.keys().next().value)
  }
  trackCountCache.set(key, count)
  return count
}

/**
 * Stored row → public payload, or null if the stored graph fails the shape
 * check (it is never served half-valid).
 */
export function publicPayload(row, { includeId = false } = {}) {
  const result = toPublicGraph(row)
  if (!result.ok) return null
  const payload = {
    project: {
      name: row.name,
      description: row.description || '',
      ...result.graph,
      track_count: cachedTrackCount(row, result.graph),
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null
    },
    author: { name: row.author_name || '' }
  }
  if (includeId) {
    payload.id = row.id
    payload.project.published_at = row.published_at ?? null
  }
  return payload
}

/** Create a project for `userId` from a public payload (one transaction, version 1). */
async function copyIntoAccount(db, userId, payload, origin) {
  const { project, author } = payload
  const name = `${project.name} (copia)`.slice(0, 100)
  const description = `Copia de "${project.name}"${author.name ? ` de ${author.name}` : ''}`.slice(0, 500)
  const metadata = {
    schemaVersion: project.metadata.schemaVersion,
    tempo: project.metadata.tempo,
    swing: project.metadata.swing,
    version: '1.0',
    created_by: userId,
    copied_from: origin,
    copied_at: new Date().toISOString(),
    node_count: project.nodes.length,
    edge_count: project.edges.length
  }
  return withTransaction(db, async () => {
    const result = await dbHelpers.createProject(db, {
      user_id: userId, name, description, nodes: project.nodes, edges: project.edges, metadata
    })
    const created = await dbHelpers.getProjectById(db, result.lastID)
    await dbHelpers.createProjectVersion(db, {
      project_id: created.id, version_number: 1, nodes: project.nodes, edges: project.edges, metadata: created.metadata
    })
    return created
  })
}

// --- Shared links --------------------------------------------------------------

async function loadShared(req) {
  const token = String(req.params.token || '')
  if (!TOKEN_RE.test(token)) return null
  const row = await dbHelpers.getSharedProject(req.app.locals.db, token)
  return row ? { row, payload: publicPayload(row) } : null
}

router.get('/shared/:token', async (req, res) => {
  try {
    const found = await loadShared(req)
    if (!found) return notFound(res)
    if (!found.payload) return res.status(422).json({ message: 'The shared project has an invalid format' })
    res.set('Cache-Control', 'no-store')
    res.json(found.payload)
  } catch (error) {
    serverError(res, 'Fetching shared project', error)
  }
})

router.post('/shared/:token/copy', authenticateJWT, async (req, res) => {
  try {
    const found = await loadShared(req)
    if (!found) return notFound(res)
    if (!found.payload) return res.status(422).json({ message: 'The shared project has an invalid format' })
    const created = await copyIntoAccount(req.app.locals.db, req.user.id, found.payload, 'shared')
    res.status(201).json({ message: 'Project copied', ...created })
  } catch (error) {
    serverError(res, 'Copying shared project', error)
  }
})

// --- Gallery -------------------------------------------------------------------

router.get('/gallery', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(GALLERY_MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || GALLERY_DEFAULT_LIMIT))
    const db = req.app.locals.db
    const total = await dbHelpers.countPublicProjects(db)
    const rows = await dbHelpers.getPublicProjectsPage(db, { limit, offset: (page - 1) * limit })
    const items = rows.map(row => {
      const graph = toPublicGraph(row)
      return {
        id: row.id,
        name: row.name,
        description: row.description || '',
        author: row.author_name || '',
        track_count: graph.ok ? cachedTrackCount(row, graph.graph) : null,
        published_at: row.published_at,
        updated_at: row.updated_at
      }
    })
    res.set('Cache-Control', 'no-store')
    res.json({ items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) })
  } catch (error) {
    serverError(res, 'Fetching gallery', error)
  }
})

async function loadPublic(req) {
  const id = parseId(req.params.id)
  if (isNaN(id)) return null
  const row = await dbHelpers.getPublicProject(req.app.locals.db, id)
  return row ? { row, payload: publicPayload(row, { includeId: true }) } : null
}

router.get('/gallery/:id', async (req, res) => {
  try {
    const found = await loadPublic(req)
    if (!found) return res.status(404).json({ message: 'Public project not found' })
    if (!found.payload) return res.status(422).json({ message: 'The project has an invalid format' })
    res.set('Cache-Control', 'no-store')
    res.json(found.payload)
  } catch (error) {
    serverError(res, 'Fetching public project', error)
  }
})

router.post('/gallery/:id/copy', authenticateJWT, async (req, res) => {
  try {
    const found = await loadPublic(req)
    if (!found) return res.status(404).json({ message: 'Public project not found' })
    if (!found.payload) return res.status(422).json({ message: 'The project has an invalid format' })
    const created = await copyIntoAccount(req.app.locals.db, req.user.id, found.payload, 'gallery')
    res.status(201).json({ message: 'Project copied', ...created })
  } catch (error) {
    serverError(res, 'Copying public project', error)
  }
})

export default router
