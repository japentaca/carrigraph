import express from 'express'
import { randomBytes } from 'crypto'
import { dbHelpers, withTransaction } from '../database.js'
import { validateGraph } from '../../src/audio/graph/validateGraph.js'

// Shared with the browser (shared view). Re-exported for existing imports.
export { validateGraph }

const router = express.Router()

// --- Validation -------------------------------------------------------------

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const validateNameAndDescription = (name, description) => {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return 'Project name is required'
  }
  if (name.length > 100) {
    return 'Project name must be 100 characters or less'
  }
  if (description !== undefined && description !== null && typeof description !== 'string') {
    return 'Project description must be a string'
  }
  if (description && description.length > 500) {
    return 'Project description must be 500 characters or less'
  }
  return null
}

const parseId = (value) => {
  if (!/^\d+$/.test(String(value))) return NaN
  return parseInt(value, 10)
}

/**
 * Load a project and check ownership. Sends the error response and returns
 * null when the request cannot continue.
 */
const loadOwnedProject = async (req, res, projectId) => {
  const project = await dbHelpers.getProjectById(req.app.locals.db, projectId)
  if (!project) {
    res.status(404).json({ message: 'Project not found' })
    return null
  }
  if (project.user_id !== req.user.id) {
    res.status(403).json({ message: 'Access denied - you do not own this project' })
    return null
  }
  return project
}

const sendServerError = (res, label, error) => {
  console.error(`${label} error:`, error)
  res.status(500).json({ message: `Internal server error while ${label.toLowerCase()}` })
}

// --- Routes -----------------------------------------------------------------

// List the user's projects (summary: no nodes/edges, with counts)
router.get('/', async (req, res) => {
  try {
    const projects = await dbHelpers.getUserProjectSummaries(req.app.locals.db, req.user.id)
    res.json(projects)
  } catch (error) {
    sendServerError(res, 'Fetching projects', error)
  }
})

// Get a specific project by ID (full)
router.get('/:id', async (req, res) => {
  try {
    const projectId = parseId(req.params.id)
    if (isNaN(projectId)) {
      return res.status(400).json({ message: 'Invalid project ID' })
    }
    const project = await loadOwnedProject(req, res, projectId)
    if (!project) return
    res.json(project)
  } catch (error) {
    sendServerError(res, 'Fetching project', error)
  }
})

// Create a new project
router.post('/create', async (req, res) => {
  try {
    const { name, description, nodes = [], edges = [], metadata = {} } = req.body ?? {}

    const nameError = validateNameAndDescription(name, description)
    if (nameError) return res.status(400).json({ message: nameError })

    const graphError = validateGraph(nodes, edges)
    if (graphError) return res.status(400).json({ message: graphError })

    if (!isPlainObject(metadata)) {
      return res.status(400).json({ message: 'Metadata must be an object' })
    }

    const db = req.app.locals.db

    const newProject = await withTransaction(db, async () => {
      const result = await dbHelpers.createProject(db, {
        user_id: req.user.id,
        name: name.trim(),
        description: description?.trim() || null,
        nodes,
        edges,
        metadata: {
          ...metadata,
          version: '1.0',
          created_by: req.user.id,
          node_count: nodes.length,
          edge_count: edges.length
        }
      })

      const project = await dbHelpers.getProjectById(db, result.lastID)

      await dbHelpers.createProjectVersion(db, {
        project_id: project.id,
        version_number: 1,
        nodes,
        edges,
        metadata: project.metadata
      })

      return project
    })

    res.status(201).json({
      message: 'Project created successfully',
      ...newProject
    })
  } catch (error) {
    sendServerError(res, 'Creating project', error)
  }
})

// Update an existing project. `nodes`/`edges` are optional: when omitted, the
// stored graph is kept (so renaming from the project list does not wipe it).
router.put('/:id', async (req, res) => {
  try {
    const projectId = parseId(req.params.id)
    if (isNaN(projectId)) {
      return res.status(400).json({ message: 'Invalid project ID' })
    }

    const body = req.body ?? {}
    const { name, description, metadata = {} } = body

    const nameError = validateNameAndDescription(name, description)
    if (nameError) return res.status(400).json({ message: nameError })

    if (!isPlainObject(metadata)) {
      return res.status(400).json({ message: 'Metadata must be an object' })
    }

    const hasNodes = body.nodes !== undefined
    const hasEdges = body.edges !== undefined
    if (hasNodes || hasEdges) {
      const graphError = validateGraph(hasNodes ? body.nodes : [], hasEdges ? body.edges : [])
      if (graphError) return res.status(400).json({ message: graphError })
    }

    const db = req.app.locals.db

    // Optional optimistic concurrency (Fase 4A): the editor sends the
    // `updated_at` its copy is based on; if the stored project changed since,
    // nothing is written and 409 is returned with the server's state.
    const baseUpdatedAt = body.base_updated_at
    if (baseUpdatedAt !== undefined && baseUpdatedAt !== null && typeof baseUpdatedAt !== 'string') {
      return res.status(400).json({ message: 'base_updated_at must be a string' })
    }

    const existing = await loadOwnedProject(req, res, projectId)
    if (!existing) return

    let conflict = null
    const updatedProject = await withTransaction(db, async () => {
      // Re-read inside the transaction so the version diff is consistent
      const current = await dbHelpers.getProjectById(db, projectId)
      if (baseUpdatedAt && current.updated_at !== baseUpdatedAt) {
        conflict = current
        return null
      }
      const nodes = hasNodes ? body.nodes : current.nodes
      const edges = hasEdges ? body.edges : current.edges

      const nextVersionNumber = await dbHelpers.getNextVersionNumber(db, projectId)

      const newMetadata = {
        ...current.metadata,
        ...metadata,
        last_modified_by: req.user.id,
        node_count: nodes.length,
        edge_count: edges.length,
        version: nextVersionNumber
      }

      await dbHelpers.updateProject(db, projectId, {
        name: name.trim(),
        description: description === undefined ? current.description : (description?.trim() || null),
        nodes,
        edges,
        metadata: newMetadata
      })

      const hasSignificantChanges =
        JSON.stringify(current.nodes) !== JSON.stringify(nodes) ||
        JSON.stringify(current.edges) !== JSON.stringify(edges)

      if (hasSignificantChanges) {
        await dbHelpers.createProjectVersion(db, {
          project_id: projectId,
          version_number: nextVersionNumber,
          nodes,
          edges,
          metadata: {
            ...current.metadata,
            ...metadata,
            version: nextVersionNumber
          }
        })
        await dbHelpers.pruneProjectVersions(db, projectId)
      }

      return dbHelpers.getProjectById(db, projectId)
    })

    if (conflict) {
      return res.status(409).json({
        message: 'The project was modified elsewhere since it was loaded',
        code: 'conflict',
        current: {
          id: conflict.id,
          name: conflict.name,
          updated_at: conflict.updated_at,
          node_count: conflict.nodes.length,
          edge_count: conflict.edges.length,
          version: conflict.metadata?.version ?? null
        }
      })
    }

    res.json({
      message: 'Project updated successfully',
      ...updatedProject
    })
  } catch (error) {
    sendServerError(res, 'Updating project', error)
  }
})

// Delete a project
router.delete('/:id', async (req, res) => {
  try {
    const projectId = parseId(req.params.id)
    if (isNaN(projectId)) {
      return res.status(400).json({ message: 'Invalid project ID' })
    }

    const project = await loadOwnedProject(req, res, projectId)
    if (!project) return

    // Versions are removed by ON DELETE CASCADE
    await dbHelpers.deleteProject(req.app.locals.db, projectId)

    res.json({ message: 'Project deleted successfully' })
  } catch (error) {
    sendServerError(res, 'Deleting project', error)
  }
})

// Duplicate a project
router.post('/:id/duplicate', async (req, res) => {
  try {
    const projectId = parseId(req.params.id)
    const { name } = req.body ?? {}

    if (isNaN(projectId)) {
      return res.status(400).json({ message: 'Invalid project ID' })
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ message: 'New project name is required' })
    }
    if (name.length > 100) {
      return res.status(400).json({ message: 'Project name must be 100 characters or less' })
    }

    const db = req.app.locals.db

    const original = await loadOwnedProject(req, res, projectId)
    if (!original) return

    const duplicatedProject = await withTransaction(db, async () => {
      const result = await dbHelpers.createProject(db, {
        user_id: req.user.id,
        name: name.trim(),
        description: `Copy of ${original.name}`,
        nodes: original.nodes,
        edges: original.edges,
        metadata: {
          ...original.metadata,
          original_project_id: original.id,
          duplicated_at: new Date().toISOString(),
          version: '1.0'
        }
      })

      const project = await dbHelpers.getProjectById(db, result.lastID)

      await dbHelpers.createProjectVersion(db, {
        project_id: project.id,
        version_number: 1,
        nodes: original.nodes,
        edges: original.edges,
        metadata: project.metadata
      })

      return project
    })

    res.status(201).json({
      message: 'Project duplicated successfully',
      ...duplicatedProject
    })
  } catch (error) {
    sendServerError(res, 'Duplicating project', error)
  }
})

// Version history (lightweight: no nodes/edges)
router.get('/:id/versions', async (req, res) => {
  try {
    const projectId = parseId(req.params.id)
    if (isNaN(projectId)) {
      return res.status(400).json({ message: 'Invalid project ID' })
    }

    const project = await loadOwnedProject(req, res, projectId)
    if (!project) return

    const versions = await dbHelpers.getProjectVersionList(req.app.locals.db, projectId)
    res.json(versions)
  } catch (error) {
    sendServerError(res, 'Fetching project versions', error)
  }
})

// One full version
router.get('/:id/versions/:versionNumber', async (req, res) => {
  try {
    const projectId = parseId(req.params.id)
    const versionNumber = parseId(req.params.versionNumber)
    if (isNaN(projectId) || isNaN(versionNumber)) {
      return res.status(400).json({ message: 'Invalid project ID or version number' })
    }

    const project = await loadOwnedProject(req, res, projectId)
    if (!project) return

    const version = await dbHelpers.getProjectVersion(req.app.locals.db, projectId, versionNumber)
    if (!version) {
      return res.status(404).json({ message: 'Version not found' })
    }
    res.json(version)
  } catch (error) {
    sendServerError(res, 'Fetching project version', error)
  }
})

// Restore project to a specific version (creates a new version)
router.post('/:id/restore/:versionNumber', async (req, res) => {
  try {
    const projectId = parseId(req.params.id)
    const versionNumber = parseId(req.params.versionNumber)

    if (isNaN(projectId) || isNaN(versionNumber)) {
      return res.status(400).json({ message: 'Invalid project ID or version number' })
    }

    const db = req.app.locals.db

    const project = await loadOwnedProject(req, res, projectId)
    if (!project) return

    const restoredProject = await withTransaction(db, async () => {
      const targetVersion = await dbHelpers.getProjectVersion(db, projectId, versionNumber)
      if (!targetVersion) return null

      const nextVersionNumber = await dbHelpers.getNextVersionNumber(db, projectId)

      await dbHelpers.updateProject(db, projectId, {
        name: project.name,
        description: project.description,
        nodes: targetVersion.nodes,
        edges: targetVersion.edges,
        metadata: {
          ...project.metadata,
          restored_from_version: versionNumber,
          restored_at: new Date().toISOString(),
          node_count: targetVersion.nodes.length,
          edge_count: targetVersion.edges.length,
          version: nextVersionNumber
        }
      })

      await dbHelpers.createProjectVersion(db, {
        project_id: projectId,
        version_number: nextVersionNumber,
        nodes: targetVersion.nodes,
        edges: targetVersion.edges,
        metadata: {
          ...project.metadata,
          restored_from_version: versionNumber,
          version: nextVersionNumber
        }
      })
      await dbHelpers.pruneProjectVersions(db, projectId)

      return dbHelpers.getProjectById(db, projectId)
    })

    if (!restoredProject) {
      return res.status(404).json({ message: 'Version not found' })
    }

    res.json({
      message: `Project restored to version ${versionNumber}`,
      ...restoredProject
    })
  } catch (error) {
    sendServerError(res, 'Restoring project version', error)
  }
})

// --- Sharing and gallery (Fase 5A; owner only) ---------------------------------

/** Unguessable share token: 24 random bytes from the OS CSPRNG, base64url (32 chars). */
export const generateShareToken = () => randomBytes(24).toString('base64url')

const shareInfo = (share) => share
  ? { token: share.token, path: `/s/${share.token}`, created_at: share.created_at }
  : null

// Current share link and gallery state of a project
router.get('/:id/share', async (req, res) => {
  try {
    const projectId = parseId(req.params.id)
    if (isNaN(projectId)) return res.status(400).json({ message: 'Invalid project ID' })
    const project = await loadOwnedProject(req, res, projectId)
    if (!project) return
    const db = req.app.locals.db
    const share = await dbHelpers.getShareByProject(db, projectId)
    res.json({ share: shareInfo(share), is_public: !!project.is_public, published_at: project.published_at ?? null })
  } catch (error) {
    sendServerError(res, 'Fetching share link', error)
  }
})

// Create the public read-only link (returns the existing one if there is one)
router.post('/:id/share', async (req, res) => {
  try {
    const projectId = parseId(req.params.id)
    if (isNaN(projectId)) return res.status(400).json({ message: 'Invalid project ID' })
    const project = await loadOwnedProject(req, res, projectId)
    if (!project) return
    const db = req.app.locals.db

    const { share, created } = await withTransaction(db, async () => {
      const existing = await dbHelpers.getShareByProject(db, projectId)
      if (existing) return { share: existing, created: false }
      await dbHelpers.createShare(db, projectId, generateShareToken())
      return { share: await dbHelpers.getShareByProject(db, projectId), created: true }
    })

    res.status(created ? 201 : 200).json({ share: shareInfo(share) })
  } catch (error) {
    sendServerError(res, 'Creating share link', error)
  }
})

// Revoke the link: the token stops working right away (a new link gets a new token)
router.delete('/:id/share', async (req, res) => {
  try {
    const projectId = parseId(req.params.id)
    if (isNaN(projectId)) return res.status(400).json({ message: 'Invalid project ID' })
    const project = await loadOwnedProject(req, res, projectId)
    if (!project) return
    const result = await dbHelpers.deleteShare(req.app.locals.db, projectId)
    res.json({ message: 'Share link revoked', revoked: result.changes > 0, share: null })
  } catch (error) {
    sendServerError(res, 'Revoking share link', error)
  }
})

// Show / hide the project in the public gallery. Body: { public: boolean }
router.put('/:id/public', async (req, res) => {
  try {
    const projectId = parseId(req.params.id)
    if (isNaN(projectId)) return res.status(400).json({ message: 'Invalid project ID' })
    const isPublic = req.body?.public
    if (typeof isPublic !== 'boolean') {
      return res.status(400).json({ message: 'public must be a boolean' })
    }
    const project = await loadOwnedProject(req, res, projectId)
    if (!project) return
    const db = req.app.locals.db
    await dbHelpers.setProjectPublic(db, projectId, isPublic)
    const row = await db.get('SELECT is_public, published_at, updated_at FROM projects WHERE id = ?', projectId)
    res.json({ id: projectId, is_public: !!row.is_public, published_at: row.published_at, updated_at: row.updated_at })
  } catch (error) {
    sendServerError(res, 'Updating gallery visibility', error)
  }
})

export default router
