import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { Passport } from 'passport'
import { Strategy as LocalStrategy } from 'passport-local'
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt'
import bcrypt from 'bcryptjs'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { dbHelpers } from './database.js'
import authRoutes from './routes/auth.js'
import projectRoutes from './routes/projects.js'
import publicRoutes from './routes/public.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_DIST_DIR = join(__dirname, '..', 'dist')

/** Parse a comma-separated CORS_ORIGIN value. `*` allows any origin. */
export const parseCorsOrigin = (value) => {
  if (!value || !value.trim()) return ['http://localhost:3000']
  const list = value.split(',').map(s => s.trim()).filter(Boolean)
  if (list.includes('*')) return true
  return list
}

/**
 * Parse TRUST_PROXY for Express' `trust proxy` setting: empty → undefined
 * (not set), `true` / `false`, a number of hops, or a value Express
 * understands as is (`loopback`, an address, a comma-separated list).
 */
export const parseTrustProxy = (value) => {
  if (value == null || !String(value).trim()) return undefined
  const v = String(value).trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^\d+$/.test(v)) return Number(v)
  return v
}

/**
 * Build the Express app. Does not listen; see server/index.js.
 *
 * @param {object} options
 * @param {import('sqlite').Database} options.db
 * @param {string} options.jwtSecret
 * @param {string|string[]|boolean} [options.corsOrigin] - origins allowed by CORS
 * @param {false|{ windowMs?: number, max?: number }} [options.rateLimit] - limits for
 *   /api/login, /api/register, /api/change-password and /api/account; `false`
 *   disables them (default: disabled in tests)
 * @param {false|{ windowMs?: number, max?: number }} [options.publicRateLimit] - limit for
 *   the public endpoints (/api/shared, /api/gallery); `false` disables it (default:
 *   disabled in tests; 120 requests per minute per IP otherwise)
 * @param {boolean|number|string} [options.trustProxy] - Express `trust proxy`. Behind a
 *   reverse proxy (nginx) set it (`loopback`) so `req.ip`, and with it the per-IP rate
 *   limits, is the visitor's address taken from X-Forwarded-For. Default: TRUST_PROXY
 * @param {boolean} [options.serveStatic] - serve `distDir` with SPA fallback
 * @param {string} [options.distDir]
 */
export const createApp = (options) => {
  const {
    db,
    jwtSecret,
    corsOrigin = parseCorsOrigin(process.env.CORS_ORIGIN),
    rateLimit: rateLimitOptions = process.env.NODE_ENV === 'test' ? false : {},
    publicRateLimit: publicRateLimitOptions = process.env.NODE_ENV === 'test' ? false : {},
    trustProxy = parseTrustProxy(process.env.TRUST_PROXY),
    serveStatic = process.env.NODE_ENV === 'production',
    distDir = DEFAULT_DIST_DIR
  } = options

  if (!db) throw new Error('createApp: db is required')
  if (!jwtSecret) throw new Error('createApp: jwtSecret is required')

  const app = express()
  const passport = new Passport()

  app.disable('x-powered-by')
  // Not set by default: trusting X-Forwarded-For without a proxy in front
  // would let any client choose its own IP for the rate limits.
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy)

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'blob:'],
        'media-src': ["'self'", 'data:', 'blob:'],
        'worker-src': ["'self'", 'blob:'],
        'connect-src': ["'self'"],
        // Allow plain-HTTP deployments (e.g. a LAN box) to keep working
        'upgrade-insecure-requests': null
      }
    }
  }))

  app.use(cors({
    origin: corsOrigin,
    credentials: true
  }))

  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))

  app.use(passport.initialize())

  passport.use(new LocalStrategy(
    { usernameField: 'email', passwordField: 'password' },
    async (email, password, done) => {
      try {
        const user = await dbHelpers.getUserByEmail(db, email)
        if (!user) {
          return done(null, false, { message: 'Invalid email or password' })
        }
        const isValidPassword = await bcrypt.compare(password, user.password)
        if (!isValidPassword) {
          return done(null, false, { message: 'Invalid email or password' })
        }
        const { password: _, ...userWithoutPassword } = user
        return done(null, userWithoutPassword)
      } catch (error) {
        return done(error)
      }
    }
  ))

  passport.use(new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret
    },
    async (payload, done) => {
      try {
        const user = await db.get('SELECT id, name, email, created_at FROM users WHERE id = ?', payload.id)
        return done(null, user || false)
      } catch (error) {
        return done(error, false)
      }
    }
  ))

  const authenticateJWT = (req, res, next) => {
    passport.authenticate('jwt', { session: false }, (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Authentication error' })
      }
      if (!user) {
        return res.status(401).json({ message: 'Unauthorized' })
      }
      req.user = user
      next()
    })(req, res, next)
  }

  app.locals.db = db
  app.locals.JWT_SECRET = jwtSecret
  app.locals.passport = passport
  app.locals.authenticateJWT = authenticateJWT

  // Rate limiting for credential endpoints
  if (rateLimitOptions !== false) {
    // Separate counters per endpoint (per client IP)
    const makeLimiter = () => rateLimit({
      windowMs: rateLimitOptions.windowMs ?? 15 * 60 * 1000,
      limit: rateLimitOptions.max ?? 20,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { message: 'Demasiados intentos. Probá de nuevo en unos minutos.' }
    })
    app.use('/api/login', makeLimiter())
    app.use('/api/register', makeLimiter())
    // Fase 5A: endpoints that check the current password
    app.use('/api/change-password', makeLimiter())
    app.use('/api/account', makeLimiter())
  }

  // Fase 5A: public read-only endpoints (no auth) get their own limit
  if (publicRateLimitOptions !== false) {
    const publicLimiter = rateLimit({
      windowMs: publicRateLimitOptions.windowMs ?? 60 * 1000,
      limit: publicRateLimitOptions.max ?? 120,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { message: 'Demasiados pedidos. Probá de nuevo en un rato.' }
    })
    app.use('/api/shared', publicLimiter)
    app.use('/api/gallery', publicLimiter)
  }

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    })
  })

  app.use('/api', authRoutes)
  app.use('/api/projects', authenticateJWT, projectRoutes)
  app.use('/api', publicRoutes)

  // Unknown API routes
  app.use('/api', (req, res) => {
    res.status(404).json({ message: 'Route not found' })
  })

  // Production: serve the built SPA with index.html fallback
  if (serveStatic) {
    const indexFile = join(distDir, 'index.html')
    if (!existsSync(indexFile)) {
      console.warn(`⚠️  serveStatic enabled but ${indexFile} does not exist (run npm run build)`)
    }
    app.use(express.static(distDir, { index: false }))
    app.use((req, res, next) => {
      if ((req.method === 'GET' || req.method === 'HEAD') && existsSync(indexFile)) {
        return res.sendFile(indexFile)
      }
      next()
    })
  }

  // Error handling middleware
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ message: 'Invalid JSON body' })
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ message: 'Request body too large (max 1 MB)' })
    }

    const status = err?.statusCode || err?.status
    const isTestEnv = process.env.NODE_ENV === 'test'
    if (!isTestEnv || !(status < 500)) {
      console.error('Error:', err)
    }

    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message })
    }
    if (err.name === 'UnauthorizedError') {
      return res.status(401).json({ message: 'Unauthorized' })
    }
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({ message: err.message || 'Bad request' })
    }
    res.status(500).json({ message: 'Internal server error' })
  })

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ message: 'Route not found' })
  })

  return app
}

export default createApp
