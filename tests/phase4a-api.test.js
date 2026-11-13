// Fase 4A: save conflicts (PUT with base_updated_at → 409) and updated_at
// with millisecond precision.
import request from 'supertest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initializeDatabase } from '../server/database.js';
import {
  createTestDatabase,
  createTestApp,
  createTestUser,
  generateJWT,
  cleanDatabase
} from './helpers.js';

const nodes = [
  { id: 'a', type: 'pattern', position: { x: 0, y: 0 }, data: { algorithm: 'euclidean' } },
  { id: 'b', type: 'voice', position: { x: 200, y: 0 }, data: { instrument: 'Piano' } }
];
const edges = [{ id: 'e1', source: 'a', target: 'b' }];

describe('Fase 4A — conflictos al guardar', () => {
  let app;
  let db;
  let user;
  let token;
  const auth = (req) => req.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);
  });

  beforeEach(async () => {
    await cleanDatabase(db);
    user = await createTestUser(db);
    token = generateJWT(user.id, user.email);
  });

  afterAll(async () => {
    await db.close();
  });

  const create = async () => {
    const res = await auth(request(app).post('/api/projects/create'))
      .send({ name: 'P', nodes, edges })
      .expect(201);
    return res.body;
  };

  it('updated_at changes on every save, even within the same second (ms precision)', async () => {
    const p = await create();
    const r1 = await auth(request(app).put(`/api/projects/${p.id}`)).send({ name: 'P', nodes, edges: [] }).expect(200);
    const r2 = await auth(request(app).put(`/api/projects/${p.id}`)).send({ name: 'P', nodes, edges }).expect(200);
    expect(r1.body.updated_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/);
    expect(r2.body.updated_at).not.toBe(r1.body.updated_at);
    expect(r2.body.updated_at > r1.body.updated_at).toBe(true);
  });

  it('accepts a save whose base_updated_at matches the stored one and returns the new updated_at', async () => {
    const p = await create();
    const res = await auth(request(app).put(`/api/projects/${p.id}`))
      .send({ name: 'P', nodes, edges: [], base_updated_at: p.updated_at })
      .expect(200);
    expect(res.body.edges).toEqual([]);
    expect(res.body.updated_at).not.toBe(p.updated_at);

    // Chained saves: each one based on the previous response
    const res2 = await auth(request(app).put(`/api/projects/${p.id}`))
      .send({ name: 'P', nodes, edges, base_updated_at: res.body.updated_at })
      .expect(200);
    expect(res2.body.edges).toHaveLength(1);
  });

  it('rejects with 409 a save based on an old copy and writes nothing', async () => {
    const p = await create();
    // Another tab saves first
    const other = await auth(request(app).put(`/api/projects/${p.id}`))
      .send({ name: 'Otra pestaña', nodes, edges: [], base_updated_at: p.updated_at })
      .expect(200);

    const versionsBefore = await auth(request(app).get(`/api/projects/${p.id}/versions`)).expect(200);

    // This tab still has the original updated_at
    const res = await auth(request(app).put(`/api/projects/${p.id}`))
      .send({ name: 'Esta pestaña', nodes: [nodes[0]], edges: [], base_updated_at: p.updated_at })
      .expect(409);
    expect(res.body.code).toBe('conflict');
    expect(res.body.current).toMatchObject({
      id: p.id, name: 'Otra pestaña', updated_at: other.body.updated_at, node_count: 2, edge_count: 0
    });

    const stored = await auth(request(app).get(`/api/projects/${p.id}`)).expect(200);
    expect(stored.body.name).toBe('Otra pestaña');
    expect(stored.body.nodes).toHaveLength(2);
    expect(stored.body.updated_at).toBe(other.body.updated_at);
    const versionsAfter = await auth(request(app).get(`/api/projects/${p.id}/versions`)).expect(200);
    expect(versionsAfter.body).toHaveLength(versionsBefore.body.length);
  });

  it('overwrites when the client sends no base (the "Sobrescribir" choice)', async () => {
    const p = await create();
    await auth(request(app).put(`/api/projects/${p.id}`)).send({ name: 'Otra', nodes, edges: [] }).expect(200);
    const res = await auth(request(app).put(`/api/projects/${p.id}`))
      .send({ name: 'Mía', nodes: [nodes[0]], edges: [] })
      .expect(200);
    expect(res.body.name).toBe('Mía');
    expect(res.body.nodes).toHaveLength(1);
  });

  it('a restore changes updated_at, so a tab based on the previous copy gets 409', async () => {
    const p = await create();
    await auth(request(app).put(`/api/projects/${p.id}`)).send({ name: 'P', nodes, edges: [], base_updated_at: p.updated_at }).expect(200);
    const loaded = await auth(request(app).get(`/api/projects/${p.id}`)).expect(200);
    const restored = await auth(request(app).post(`/api/projects/${p.id}/restore/1`)).expect(200);
    expect(restored.body.updated_at).not.toBe(loaded.body.updated_at);
    await auth(request(app).put(`/api/projects/${p.id}`))
      .send({ name: 'P', nodes, edges: [], base_updated_at: loaded.body.updated_at })
      .expect(409);
  });

  it('renaming from the project list (no base) never conflicts', async () => {
    const p = await create();
    await auth(request(app).put(`/api/projects/${p.id}`)).send({ name: 'Otro nombre' }).expect(200);
  });

  it('validates base_updated_at type', async () => {
    const p = await create();
    await auth(request(app).put(`/api/projects/${p.id}`))
      .send({ name: 'P', nodes, edges, base_updated_at: 123 })
      .expect(400);
  });

  it('a base for another user\'s project still answers 403, not 409', async () => {
    const p = await create();
    const other = await createTestUser(db, { email: 'other@example.com' });
    await request(app).put(`/api/projects/${p.id}`)
      .set('Authorization', `Bearer ${generateJWT(other.id, other.email)}`)
      .send({ name: 'X', nodes, edges, base_updated_at: 'viejo' })
      .expect(403);
  });
});

describe('Fase 4A — migración del trigger de updated_at', () => {
  it('replaces the old whole-second trigger in an existing database file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-4a-'));
    const file = join(dir, 'old.db');
    const triggerSql = async (db) => (await db.get(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'update_projects_timestamp'")).sql;
    try {
      // A database created before Fase 4A (old trigger)
      const db = await initializeDatabase(file, { silent: true });
      await db.exec(`
        DROP TRIGGER IF EXISTS update_projects_timestamp;
        CREATE TRIGGER update_projects_timestamp AFTER UPDATE ON projects
        BEGIN UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
      `);
      const u = await db.run("INSERT INTO users (name, email, password) VALUES ('a', 'a@a.com', 'x')");
      const r = await db.run("INSERT INTO projects (user_id, name) VALUES (?, 'p')", u.lastID);
      expect(await triggerSql(db)).not.toMatch(/strftime/);
      await db.close();

      // Reopened by the new code: trigger replaced, data intact
      const db2 = await initializeDatabase(file, { silent: true });
      expect(await triggerSql(db2)).toMatch(/strftime/);
      // An UPDATE that does not set updated_at still gets milliseconds
      await db2.run("UPDATE projects SET name = 'q' WHERE id = ?", r.lastID);
      const row = await db2.get('SELECT name, updated_at FROM projects WHERE id = ?', r.lastID);
      expect(row.name).toBe('q');
      expect(row.updated_at).toMatch(/\.\d{3}$/);
      await db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
