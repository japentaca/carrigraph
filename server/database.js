import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, mkdirSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const DEFAULT_DB_PATH = join(__dirname, 'data', 'carrigraph.db')

/** Maximum number of versions kept per project (older ones are pruned). */
export const MAX_VERSIONS_PER_PROJECT = 50

/** SQL expression: current UTC time with milliseconds ("YYYY-MM-DD HH:MM:SS.SSS"). */
export const NOW_MS = "strftime('%Y-%m-%d %H:%M:%f', 'now')"

export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase()

/**
 * Open (and migrate) the SQLite database.
 *
 * @param {string} [dbPath] - file path, or ':memory:' for tests. Defaults to
 *   `DB_PATH` env var or `server/data/carrigraph.db`.
 * @param {{ silent?: boolean }} [options]
 */
export const initializeDatabase = async (dbPath = process.env.DB_PATH || DEFAULT_DB_PATH, options = {}) => {
  const { silent = false } = options

  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  })

  await db.exec('PRAGMA foreign_keys = ON')

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      nodes TEXT DEFAULT '[]',
      edges TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `)

  await db.exec(`
    CREATE TABLE IF NOT EXISTS project_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      nodes TEXT NOT NULL,
      edges TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    )
  `)

  // Migration: sessions were never used (auth is JWT only). Dropping the table
  // also drops its indexes. Other tables are untouched.
  await db.exec('DROP TABLE IF EXISTS user_sessions')

  // Fase 5A: public read-only links (one per project; revoking deletes the row).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS project_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    )
  `)

  // Fase 5A: public gallery flag. ALTER TABLE only when the column is missing
  // (existing databases keep their rows; every project starts private).
  const projectColumns = (await db.all('PRAGMA table_info(projects)')).map(c => c.name)
  if (!projectColumns.includes('is_public')) {
    await db.exec('ALTER TABLE projects ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0')
  }
  if (!projectColumns.includes('published_at')) {
    await db.exec('ALTER TABLE projects ADD COLUMN published_at DATETIME')
  }

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects (user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_versions_project_id ON project_versions (project_id);
    CREATE INDEX IF NOT EXISTS idx_project_versions_project_version ON project_versions (project_id, version_number);
    CREATE INDEX IF NOT EXISTS idx_projects_public ON projects (is_public, published_at DESC);
  `)

  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_users_timestamp
    AFTER UPDATE ON users
    BEGIN
      UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `)

  // Fase 4A: projects.updated_at has millisecond precision (the editor sends
  // it back as the base of a save to detect conflicts; whole seconds could
  // hide a concurrent write). The trigger only fills it when an UPDATE did not
  // set it itself. Replaces the old trigger in existing databases.
  // Fase 5A: only content columns count; publishing/unpublishing a project
  // (is_public, published_at) must not change updated_at, or the editor's
  // next save would see a false conflict.
  await db.exec(`
    DROP TRIGGER IF EXISTS update_projects_timestamp;
    CREATE TRIGGER update_projects_timestamp
    AFTER UPDATE OF user_id, name, description, nodes, edges, metadata ON projects
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
      UPDATE projects SET updated_at = ${NOW_MS} WHERE id = NEW.id;
    END;
  `)

  if (!silent) {
    const userCount = await db.get('SELECT COUNT(*) as count FROM users')
    const projectCount = await db.get('SELECT COUNT(*) as count FROM projects')
    console.log(`📁 Database location: ${dbPath}`)
    console.log(`👥 Users: ${userCount.count}`)
    console.log(`📊 Projects: ${projectCount.count}`)
  }

  return db
}

// --- Transactions -----------------------------------------------------------

// The app shares a single SQLite connection, so transactions must not overlap.
// Each db handle gets its own promise queue.
const txQueues = new WeakMap()

/**
 * Run `fn(db)` inside BEGIN/COMMIT, rolling back on error. Transactions on the
 * same connection are serialized.
 */
export const withTransaction = async (db, fn) => {
  const previous = txQueues.get(db) || Promise.resolve()
  let release
  const current = new Promise(resolve => { release = resolve })
  txQueues.set(db, previous.then(() => current))

  await previous
  try {
    await db.exec('BEGIN IMMEDIATE')
    try {
      const result = await fn(db)
      await db.exec('COMMIT')
      return result
    } catch (error) {
      await db.exec('ROLLBACK')
      throw error
    }
  } finally {
    release()
  }
}

// --- Helpers ----------------------------------------------------------------

const parseProjectRow = (project) => {
  if (!project) return project
  return {
    ...project,
    nodes: JSON.parse(project.nodes),
    edges: JSON.parse(project.edges),
    metadata: JSON.parse(project.metadata)
  }
}

const parseVersionRow = parseProjectRow

export const dbHelpers = {
  // User operations
  createUser: async (db, userData) => {
    return await db.run(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      userData.name, userData.email, userData.password
    )
  },

  /** Case-insensitive lookup (also matches legacy rows stored with capitals). */
  getUserByEmail: async (db, email) => {
    return await db.get('SELECT * FROM users WHERE lower(email) = ?', normalizeEmail(email))
  },

  getUserById: async (db, id) => {
    return await db.get('SELECT id, name, email, created_at, updated_at FROM users WHERE id = ?', id)
  },

  // Project operations
  createProject: async (db, projectData) => {
    return await db.run(
      'INSERT INTO projects (user_id, name, description, nodes, edges, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      projectData.user_id,
      projectData.name,
      projectData.description || null,
      JSON.stringify(projectData.nodes || []),
      JSON.stringify(projectData.edges || []),
      JSON.stringify(projectData.metadata || {})
    )
  },

  updateProject: async (db, projectId, projectData) => {
    return await db.run(
      `UPDATE projects SET name = ?, description = ?, nodes = ?, edges = ?, metadata = ?, updated_at = ${NOW_MS} WHERE id = ?`,
      projectData.name,
      projectData.description || null,
      JSON.stringify(projectData.nodes || []),
      JSON.stringify(projectData.edges || []),
      JSON.stringify(projectData.metadata || {}),
      projectId
    )
  },

  getProjectById: async (db, projectId) => {
    const project = await db.get('SELECT * FROM projects WHERE id = ?', projectId)
    return parseProjectRow(project)
  },

  /** Full projects (with nodes/edges) for a user. */
  getUserProjects: async (db, userId) => {
    const projects = await db.all(
      'SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC',
      userId
    )
    return projects.map(parseProjectRow)
  },

  /** Lightweight list for a user: no nodes/edges, with counts. */
  getUserProjectSummaries: async (db, userId) => {
    return await db.all(
      `SELECT p.id, p.user_id, p.name, p.description, p.created_at, p.updated_at,
              json_array_length(p.nodes) AS node_count,
              json_array_length(p.edges) AS edge_count,
              p.is_public, p.published_at, s.token AS share_token
       FROM projects p LEFT JOIN project_shares s ON s.project_id = p.id
       WHERE p.user_id = ? ORDER BY p.updated_at DESC, p.id DESC`,
      userId
    )
  },

  // --- Sharing and gallery (Fase 5A) ---------------------------------------

  getShareByProject: async (db, projectId) => {
    return await db.get('SELECT project_id, token, created_at FROM project_shares WHERE project_id = ?', projectId)
  },

  createShare: async (db, projectId, token) => {
    return await db.run('INSERT INTO project_shares (project_id, token) VALUES (?, ?)', projectId, token)
  },

  deleteShare: async (db, projectId) => {
    return await db.run('DELETE FROM project_shares WHERE project_id = ?', projectId)
  },

  /** Project behind a share token, with the owner's display name (no email). */
  getSharedProject: async (db, token) => {
    const row = await db.get(
      `SELECT p.id, p.name, p.description, p.nodes, p.edges, p.metadata, p.created_at, p.updated_at,
              u.name AS author_name
       FROM project_shares s
       JOIN projects p ON p.id = s.project_id
       JOIN users u ON u.id = p.user_id
       WHERE s.token = ?`,
      token
    )
    return parseProjectRow(row)
  },

  /** Public project of the gallery, with the owner's display name (no email). */
  getPublicProject: async (db, projectId) => {
    const row = await db.get(
      `SELECT p.id, p.name, p.description, p.nodes, p.edges, p.metadata, p.created_at, p.updated_at,
              p.published_at, u.name AS author_name
       FROM projects p JOIN users u ON u.id = p.user_id
       WHERE p.id = ? AND p.is_public = 1`,
      projectId
    )
    return parseProjectRow(row)
  },

  /** Mark / unmark a project as public. Does not touch updated_at (see trigger). */
  setProjectPublic: async (db, projectId, isPublic) => {
    return await db.run(
      `UPDATE projects SET is_public = ?, published_at = ${isPublic ? `COALESCE(published_at, ${NOW_MS})` : 'NULL'} WHERE id = ?`,
      isPublic ? 1 : 0, projectId
    )
  },

  countPublicProjects: async (db) => {
    const row = await db.get('SELECT COUNT(*) AS total FROM projects WHERE is_public = 1')
    return row.total
  },

  /** One page of the gallery, newest publication first (graph included, to count tracks). */
  getPublicProjectsPage: async (db, { limit, offset }) => {
    const rows = await db.all(
      `SELECT p.id, p.name, p.description, p.nodes, p.edges, p.metadata, p.updated_at, p.published_at,
              u.name AS author_name
       FROM projects p JOIN users u ON u.id = p.user_id
       WHERE p.is_public = 1
       ORDER BY p.published_at DESC, p.id DESC
       LIMIT ? OFFSET ?`,
      limit, offset
    )
    return rows.map(parseProjectRow)
  },

  /**
   * Delete a user and everything they own: share links, versions, projects.
   * Explicit (does not depend on foreign keys being enforced). Call inside
   * withTransaction.
   */
  deleteUserCascade: async (db, userId) => {
    await db.run('DELETE FROM project_shares WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)', userId)
    await db.run('DELETE FROM project_versions WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)', userId)
    await db.run('DELETE FROM projects WHERE user_id = ?', userId)
    return await db.run('DELETE FROM users WHERE id = ?', userId)
  },

  deleteProject: async (db, projectId) => {
    // The share link goes with the project (also ON DELETE CASCADE; explicit
    // so a deleted project can never stay reachable by its token).
    await db.run('DELETE FROM project_shares WHERE project_id = ?', projectId)
    return await db.run('DELETE FROM projects WHERE id = ?', projectId)
  },

  // Project version operations
  createProjectVersion: async (db, versionData) => {
    return await db.run(
      'INSERT INTO project_versions (project_id, version_number, nodes, edges, metadata) VALUES (?, ?, ?, ?, ?)',
      versionData.project_id,
      versionData.version_number,
      JSON.stringify(versionData.nodes),
      JSON.stringify(versionData.edges),
      JSON.stringify(versionData.metadata || {})
    )
  },

  /** Full versions (with nodes/edges), newest first. */
  getProjectVersions: async (db, projectId) => {
    const versions = await db.all(
      'SELECT * FROM project_versions WHERE project_id = ? ORDER BY version_number DESC',
      projectId
    )
    return versions.map(parseVersionRow)
  },

  /** Lightweight version list (no nodes/edges), newest first. */
  getProjectVersionList: async (db, projectId) => {
    const versions = await db.all(
      `SELECT id, project_id, version_number, metadata, created_at,
              json_array_length(nodes) AS node_count,
              json_array_length(edges) AS edge_count
       FROM project_versions WHERE project_id = ? ORDER BY version_number DESC`,
      projectId
    )
    return versions.map(v => ({ ...v, metadata: JSON.parse(v.metadata) }))
  },

  getProjectVersion: async (db, projectId, versionNumber) => {
    const version = await db.get(
      'SELECT * FROM project_versions WHERE project_id = ? AND version_number = ?',
      projectId, versionNumber
    )
    return parseVersionRow(version)
  },

  getNextVersionNumber: async (db, projectId) => {
    const row = await db.get(
      'SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM project_versions WHERE project_id = ?',
      projectId
    )
    return row.next
  },

  /** Keep only the newest `keep` versions of a project. */
  pruneProjectVersions: async (db, projectId, keep = MAX_VERSIONS_PER_PROJECT) => {
    return await db.run(
      `DELETE FROM project_versions
       WHERE project_id = ?
         AND id NOT IN (
           SELECT id FROM project_versions WHERE project_id = ?
           ORDER BY version_number DESC LIMIT ?
         )`,
      projectId, projectId, keep
    )
  }
}

export default { initializeDatabase, dbHelpers, withTransaction }
