// Example projects for a fresh deployment (server/seed.js, server/seeds/examples.json).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestDatabase, createTestApp, createTestUser, createTestProject } from './helpers.js';
import { seedExamples, exportExamples, loadExamples, toSeedEntry, EXAMPLES_USER } from '../server/seed.js';
import { countTracks } from '../src/sharing/publicProject.js';

describe('seed de ejemplos', () => {
  let db;
  let app;
  const examples = loadExamples();

  beforeEach(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('the file has valid, playable examples and nothing but public fields', () => {
    expect(examples.length).toBeGreaterThan(0);
    expect(new Set(examples.map(e => e.name)).size).toBe(examples.length);
    for (const example of examples) {
      expect(Object.keys(example).sort()).toEqual(['description', 'edges', 'metadata', 'name', 'nodes']);
      expect(Object.keys(example.metadata).sort()).toEqual(['schemaVersion', 'swing', 'tempo']);
      // already in its public, migrated form: exporting it again changes nothing
      expect(toSeedEntry(example)).toEqual(example);
      expect(countTracks(example.nodes, example.edges), example.name).toBeGreaterThan(0);
    }
  });

  it('publishes every example in the gallery, in the order of the file', async () => {
    const result = await seedExamples(db, examples);
    expect(result).toMatchObject({ inserted: examples.length, updated: 0, unchanged: 0 });

    const res = await request(app).get('/api/gallery').query({ limit: 50 }).expect(200);
    expect(res.body.items.map(i => i.name)).toEqual(examples.map(e => e.name));
    expect(res.body.items.every(i => i.author === EXAMPLES_USER.name)).toBe(true);

    const first = await request(app).get(`/api/gallery/${res.body.items[0].id}`).expect(200);
    expect(first.body.project.nodes).toEqual(examples[0].nodes);
    expect(first.body.project.metadata).toEqual(examples[0].metadata);
  });

  it('is idempotent, refreshes changed examples and leaves other data alone', async () => {
    const owner = await createTestUser(db, { email: 'ana@example.com' });
    const own = await createTestProject(db, owner.id, { name: examples[0].name });

    await seedExamples(db, examples);
    expect(await seedExamples(db, examples)).toMatchObject({ inserted: 0, updated: 0, unchanged: examples.length });

    const changed = examples.map((e, i) => (i === 0 ? { ...e, description: 'Otra descripción' } : e));
    expect(await seedExamples(db, changed)).toMatchObject({ inserted: 0, updated: 1, unchanged: examples.length - 1 });

    const { total } = await db.get('SELECT COUNT(*) AS total FROM projects');
    expect(total).toBe(examples.length + 1);
    const users = await db.get('SELECT COUNT(*) AS total FROM users');
    expect(users.total).toBe(2);
    // a user's project with the same name is not touched nor published
    const mine = await db.get('SELECT user_id, is_public FROM projects WHERE id = ?', own.id);
    expect(mine).toEqual({ user_id: owner.id, is_public: 0 });
  });

  it('nobody can log in as the owner of the examples', async () => {
    await seedExamples(db, examples);
    for (const password of ['', 'password', 'carrigraph', EXAMPLES_USER.email]) {
      const res = await request(app).post('/api/login').send({ email: EXAMPLES_USER.email, password });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.token).toBeUndefined();
    }
  });

  it('export takes the projects named "Ejemplo…" in natural order, without private fields', async () => {
    const owner = await createTestUser(db);
    const graph = { nodes: examples[0].nodes, edges: examples[0].edges };
    await createTestProject(db, owner.id, { ...graph, name: 'Ejemplo 10 · B', metadata: { tempo: 90, created_by: owner.id } });
    await createTestProject(db, owner.id, { ...graph, name: 'Ejemplo 2 · A' });
    await createTestProject(db, owner.id, { ...graph, name: 'Mi proyecto privado' });

    const out = await exportExamples(db);
    expect(out.map(e => e.name)).toEqual(['Ejemplo 2 · A', 'Ejemplo 10 · B']);
    expect(out[1].metadata).toEqual({ schemaVersion: examples[0].metadata.schemaVersion, tempo: 90, swing: 0 });
    expect(JSON.stringify(out)).not.toMatch(/created_by|user_id/);
  });
});
