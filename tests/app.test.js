import request from 'supertest';
import net from 'net';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initializeDatabase } from '../server/database.js';
import { createApp, parseCorsOrigin } from '../server/app.js';
import { createTestDatabase, createTestApp, createTestUser, cleanDatabase } from './helpers.js';

describe('App setup (Phase 1)', () => {
  let db;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  beforeEach(async () => {
    await cleanDatabase(db);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('module loading', () => {
    it('importing server/index.js does not start listening', async () => {
      const listenSpy = vi.spyOn(net.Server.prototype, 'listen');
      try {
        const mod = await import('../server/index.js');
        expect(typeof mod.start).toBe('function');
        expect(listenSpy).not.toHaveBeenCalled();
      } finally {
        listenSpy.mockRestore();
      }
    });

    it('createApp requires db and jwtSecret', () => {
      expect(() => createApp({ jwtSecret: 'x' })).toThrow(/db/);
      expect(() => createApp({ db })).toThrow(/jwtSecret/);
    });

    it('does not use express-session or SESSION_SECRET', async () => {
      const res = await request(createTestApp(db)).get('/api/health').expect(200);
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('security headers (helmet)', () => {
    it('sets standard security headers', async () => {
      const res = await request(createTestApp(db)).get('/api/health').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS', () => {
    it('parses CORS_ORIGIN values', () => {
      expect(parseCorsOrigin(undefined)).toEqual(['http://localhost:3000']);
      expect(parseCorsOrigin('https://a.com, https://b.com')).toEqual(['https://a.com', 'https://b.com']);
      expect(parseCorsOrigin('*')).toBe(true);
    });

    it('allows only the configured origin', async () => {
      const app = createTestApp(db, { corsOrigin: ['https://ok.example'] });

      const ok = await request(app).get('/api/health').set('Origin', 'https://ok.example');
      expect(ok.headers['access-control-allow-origin']).toBe('https://ok.example');

      const bad = await request(app).get('/api/health').set('Origin', 'https://evil.example');
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('body limits', () => {
    it('rejects JSON bodies over 1 MB with 413', async () => {
      const big = 'x'.repeat(1024 * 1024 + 10);
      const res = await request(createTestApp(db))
        .post('/api/register')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ name: big, email: 'a@b.co', password: 'password123' }))
        .expect(413);
      expect(res.body.message).toMatch(/too large/i);
    });
  });

  describe('rate limiting', () => {
    it('limits /api/login attempts when enabled', async () => {
      const app = createTestApp(db, { rateLimit: { windowMs: 60_000, max: 3 } });
      const attempt = () => request(app)
        .post('/api/login')
        .send({ email: 'nobody@example.com', password: 'wrongpassword' });

      for (let i = 0; i < 3; i++) {
        expect((await attempt()).status).toBe(401);
      }
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.body.message).toMatch(/Demasiados intentos/);
    });

    it('limits /api/register attempts when enabled', async () => {
      const app = createTestApp(db, { rateLimit: { windowMs: 60_000, max: 1 } });
      await request(app).post('/api/register').send({}).expect(400);
      await request(app).post('/api/register').send({}).expect(429);
    });

    it('counts login and register separately', async () => {
      const app = createTestApp(db, { rateLimit: { windowMs: 60_000, max: 1 } });
      await request(app).post('/api/login').send({}).expect(400);
      await request(app).post('/api/register').send({}).expect(400);
      await request(app).post('/api/login').send({}).expect(429);
    });

    it('is disabled by default in tests', async () => {
      const app = createApp({ db, jwtSecret: process.env.JWT_SECRET });
      for (let i = 0; i < 25; i++) {
        await request(app).post('/api/login').send({ email: 'x@y.z', password: 'nopenope' }).expect(401);
      }
    });

    it('does not limit other endpoints', async () => {
      const app = createTestApp(db, { rateLimit: { windowMs: 60_000, max: 1 } });
      await request(app).get('/api/health').expect(200);
      await request(app).get('/api/health').expect(200);
    });
  });

  describe('static serving (production)', () => {
    let distDir;

    beforeAll(() => {
      distDir = mkdtempSync(join(tmpdir(), 'carrigraph-dist-'));
      writeFileSync(join(distDir, 'index.html'), '<!doctype html><div id="app">SPA</div>');
      mkdirSync(join(distDir, 'assets'));
      writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log(1)');
    });

    afterAll(() => {
      rmSync(distDir, { recursive: true, force: true });
    });

    it('serves files from dist and falls back to index.html', async () => {
      const app = createTestApp(db, { serveStatic: true, distDir });

      const asset = await request(app).get('/assets/app.js').expect(200);
      expect(asset.text).toContain('console.log');

      const route = await request(app).get('/editor/12').expect(200);
      expect(route.text).toContain('SPA');
    });

    it('keeps JSON 404 for unknown /api routes', async () => {
      const app = createTestApp(db, { serveStatic: true, distDir });
      const res = await request(app).get('/api/does-not-exist').expect(404);
      expect(res.body).toHaveProperty('message', 'Route not found');
    });

    it('does not serve dist when disabled', async () => {
      const app = createTestApp(db, { serveStatic: false, distDir });
      await request(app).get('/editor/12').expect(404);
    });
  });

  describe('database migration', () => {
    let dir;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'carrigraph-db-'));
    });

    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('drops the legacy user_sessions table and keeps the data in other tables', async () => {
      const dbPath = join(dir, 'legacy.db');
      const legacy = await initializeDatabase(dbPath, { silent: true });
      await legacy.exec(`CREATE TABLE user_sessions (id TEXT PRIMARY KEY, user_id INTEGER, data TEXT, expires_at DATETIME)`);
      const user = await createTestUser(legacy, { email: 'keep@example.com' });
      await legacy.run(`INSERT INTO projects (user_id, name) VALUES (?, 'Keep me')`, user.id);
      await legacy.close();

      const migrated = await initializeDatabase(dbPath, { silent: true });
      const sessions = await migrated.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_sessions'`);
      expect(sessions).toBeUndefined();
      expect((await migrated.get('SELECT COUNT(*) AS c FROM users')).c).toBe(1);
      expect((await migrated.get('SELECT COUNT(*) AS c FROM projects')).c).toBe(1);
      await migrated.close();
    });
  });
});
