/**
 * seed.js — example projects for a fresh deployment.
 *
 *   npm run seed          insert / refresh the examples of server/seeds/examples.json
 *   npm run seed:export   rewrite that file from the projects of the local database
 *
 * The examples belong to a system user nobody can log in as (its password is
 * the hash of random bytes that are thrown away) and are published in the
 * gallery, so a new server has something to listen to and guests have
 * something to open. Seeding is idempotent: an example is matched by name
 * among that user's projects; missing ones are inserted, changed ones are
 * updated, and nothing else in the database is touched.
 *
 * Both commands use the database of `DB_PATH` (default server/data/carrigraph.db).
 */

import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import bcrypt from 'bcryptjs'
import { initializeDatabase, dbHelpers, withTransaction } from './database.js'
import { toPublicGraph } from '../src/sharing/publicProject.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const EXAMPLES_PATH = join(__dirname, 'seeds', 'examples.json')
/** Owner of the examples. `.invalid` is a reserved TLD: no mail can ever reach it. */
export const EXAMPLES_USER = Object.freeze({ name: 'CarriGraph', email: 'ejemplos@carrigraph.invalid' })
/** Local projects whose name starts like this are the ones `seed:export` writes. */
export const EXPORT_PREFIX = 'Ejemplo'

export const loadExamples = (path = EXAMPLES_PATH) => JSON.parse(readFileSync(path, 'utf8'))

/**
 * Stored project → seed entry: only what a public project shows (graph, name,
 * description, tempo, swing, schema version). No ids, owners or dates.
 */
export function toSeedEntry(project) {
  const result = toPublicGraph(project)
  if (!result.ok) throw new Error(`"${project?.name}": ${result.error}`)
  return {
    name: project.name,
    description: project.description || '',
    ...result.graph
  }
}

async function ensureExamplesUser(db) {
  const existing = await dbHelpers.getUserByEmail(db, EXAMPLES_USER.email)
  if (existing) return existing.id
  // Nobody knows this password: the account cannot be used to log in.
  const password = await bcrypt.hash(randomBytes(32).toString('hex'), 10)
  const result = await dbHelpers.createUser(db, { ...EXAMPLES_USER, password })
  return result.lastID
}

/**
 * Insert or refresh the examples and publish them in the gallery.
 * @returns {Promise<{ userId: number, inserted: number, updated: number, unchanged: number }>}
 */
export async function seedExamples(db, examples = loadExamples()) {
  const entries = examples.map(toSeedEntry)
  return withTransaction(db, async () => {
    const userId = await ensureExamplesUser(db)
    const counts = { userId, inserted: 0, updated: 0, unchanged: 0 }

    // The gallery lists the newest publication first: inserting from the last
    // example to the first leaves them in the order of the file.
    for (const entry of [...entries].reverse()) {
      const data = { ...entry, user_id: userId }
      const row = await db.get('SELECT id, description, nodes, edges, metadata FROM projects WHERE user_id = ? AND name = ?', userId, entry.name)
      let id = row?.id
      if (!row) {
        id = (await dbHelpers.createProject(db, data)).lastID
        counts.inserted++
      } else if (
        row.nodes !== JSON.stringify(entry.nodes) || row.edges !== JSON.stringify(entry.edges) ||
        row.metadata !== JSON.stringify(entry.metadata) || (row.description || '') !== entry.description
      ) {
        await dbHelpers.updateProject(db, id, data)
        counts.updated++
      } else {
        counts.unchanged++
      }
      await dbHelpers.setProjectPublic(db, id, true)
    }
    return counts
  })
}

/** Projects of the database named "Ejemplo…" → seed entries, in natural order of their names. */
export async function exportExamples(db, prefix = EXPORT_PREFIX) {
  const rows = await db.all('SELECT id FROM projects WHERE name LIKE ? ORDER BY id', `${prefix}%`)
  const projects = []
  for (const { id } of rows) projects.push(await dbHelpers.getProjectById(db, id))
  const byName = new Intl.Collator('es', { numeric: true })
  return projects.map(toSeedEntry).sort((a, b) => byName.compare(a.name, b.name))
}

async function main(argv) {
  const db = await initializeDatabase(undefined, { silent: true })
  try {
    if (argv.includes('--export')) {
      const entries = await exportExamples(db)
      if (!entries.length) throw new Error(`No hay proyectos cuyo nombre empiece con "${EXPORT_PREFIX}" en esta base`)
      writeFileSync(EXAMPLES_PATH, JSON.stringify(entries, null, 1) + '\n')
      console.log(`✅ ${entries.length} ejemplos escritos en ${EXAMPLES_PATH}`)
      return
    }
    const r = await seedExamples(db)
    console.log(`✅ Ejemplos en la galería: ${r.inserted} nuevos, ${r.updated} actualizados, ${r.unchanged} sin cambios`)
  } finally {
    await db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error('❌', error.message)
    process.exit(1)
  })
}
