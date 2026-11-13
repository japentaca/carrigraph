import { pathToFileURL } from 'url'
import { initializeDatabase } from './database.js'
import { createApp, parseCorsOrigin } from './app.js'

const requireEnv = (name) => {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

/**
 * Start the HTTP server. Environment:
 *   JWT_SECRET (required), PORT (3001), CORS_ORIGIN, DB_PATH, NODE_ENV.
 * `.env` is loaded by `node --env-file-if-exists=.env` (see package.json).
 */
export const start = async () => {
  const jwtSecret = requireEnv('JWT_SECRET')
  const port = process.env.PORT || 3001
  const corsOrigin = parseCorsOrigin(process.env.CORS_ORIGIN)

  let db
  try {
    db = await initializeDatabase()
    console.log('✅ Database initialized successfully')
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    process.exit(1)
  }

  const app = createApp({ db, jwtSecret, corsOrigin })

  return app.listen(port, () => {
    console.log(`🚀 CarriGraph server running on port ${port}`)
    console.log(`🌐 CORS origin: ${corsOrigin === true ? '*' : corsOrigin.join(', ')}`)
    if (process.env.NODE_ENV === 'production') {
      console.log('📦 Serving dist/ (production)')
    }
  })
}

// Only listen when executed directly (`node server/index.js`), never on import.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  start().catch((error) => {
    console.error(error.message || error)
    process.exit(1)
  })
}

