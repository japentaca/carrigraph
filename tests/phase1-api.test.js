import request from 'supertest';
import { dbHelpers, withTransaction, MAX_VERSIONS_PER_PROJECT } from '../server/database.js';
import {
  createTestDatabase,
  createTestApp,
  createTestUser,
  createTestProject,
  generateJWT,
  cleanDatabase
} from './helpers.js';

const sampleNodes = [
  { id: 'a', type: 'pattern', position: { x: 0, y: 0 }, data: { algorithm: 'euclidean' } },
  { id: 'b', type: 'voice', position: { x: 200, y: 0 }, data: { instrument: 'Piano' } }
];
const sampleEdges = [{ id: 'e1', source: 'a', target: 'b' }];

describe('Phase 1 API behaviour', () => {
  let app;
  let db;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);
  });

  beforeEach(async () => {
    await cleanDatabase(db);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('email normalization', () => {
    it('stores registered emails trimmed and lowercased', async () => {
      const res = await request(app)
        .post('/api/register')
        .send({ name: 'Ana', email: '  Ana@Example.COM ', password: 'password123' })
        .expect(201);
      expect(res.body.user.email).toBe('ana@example.com');
    });

    it('rejects registering the same email with different case', async () => {
      await request(app)
        .post('/api/register')
        .send({ name: 'Ana', email: 'ana@example.com', password: 'password123' })
        .expect(201);
      const res = await request(app)
        .post('/api/register')
        .send({ name: 'Ana 2', email: 'ANA@example.com', password: 'password123' })
        .expect(409);
      expect(res.body.message).toBe('User with this email already exists');
    });

    it('logs in regardless of email case', async () => {
      await request(app)
        .post('/api/register')
        .send({ name: 'Ana', email: 'ana@example.com', password: 'password123' })
        .expect(201);
      const res = await request(app)
        .post('/api/login')
        .send({ email: ' ANA@Example.com ', password: 'password123' })
        .expect(200);
      expect(res.body.user.email).toBe('ana@example.com');
    });
  });

  describe('password policy', () => {
    it('requires at least 8 characters on register', async () => {
      await request(app)
        .post('/api/register')
        .send({ name: 'Ana', email: 'ana@example.com', password: '1234567' })
        .expect(400);
      await request(app)
        .post('/api/register')
        .send({ name: 'Ana', email: 'ana@example.com', password: '12345678' })
        .expect(201);
    });
  });

  describe('projects', () => {
    let user;
    let token;

    beforeEach(async () => {
      user = await createTestUser(db, { email: 'owner@example.com' });
      token = generateJWT(user.id, user.email);
    });

    const auth = (req) => req.set('Authorization', `Bearer ${token}`);

    it('GET /api/projects returns summaries with counts', async () => {
      await createTestProject(db, user.id, { name: 'P', nodes: sampleNodes, edges: sampleEdges });
      const res = await auth(request(app).get('/api/projects')).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ name: 'P', node_count: 2, edge_count: 1 });
      expect(res.body[0]).not.toHaveProperty('nodes');
      expect(res.body[0]).not.toHaveProperty('edges');
    });

    it('PUT without nodes/edges keeps the stored graph (rename from list)', async () => {
      const project = await createTestProject(db, user.id, { nodes: sampleNodes, edges: sampleEdges });
      const res = await auth(request(app).put(`/api/projects/${project.id}`))
        .send({ name: 'Renamed', description: 'New desc' })
        .expect(200);
      expect(res.body.name).toBe('Renamed');
      expect(res.body.description).toBe('New desc');
      expect(res.body.nodes).toEqual(sampleNodes);
      expect(res.body.edges).toEqual(sampleEdges);
    });

    describe('graph validation', () => {
      const create = (body) => auth(request(app).post('/api/projects/create')).send({ name: 'X', ...body });

      it('rejects nodes that are not objects', async () => {
        const res = await create({ nodes: ['nope'] }).expect(400);
        expect(res.body.message).toMatch(/Invalid node at index 0/);
      });

      it('rejects nodes without id', async () => {
        const res = await create({ nodes: [{ type: 'pattern' }] }).expect(400);
        expect(res.body.message).toMatch(/missing id/);
      });

      it('rejects nodes with a malformed position', async () => {
        const res = await create({ nodes: [{ id: 'a', position: { x: 'left' } }] }).expect(400);
        expect(res.body.message).toMatch(/position/);
      });

      it('rejects edges without source/target', async () => {
        const res = await create({ nodes: sampleNodes, edges: [{ id: 'e', source: 'a' }] }).expect(400);
        expect(res.body.message).toMatch(/Invalid edge at index 0/);
      });

      it('rejects non-object metadata', async () => {
        await create({ metadata: [1, 2] }).expect(400);
      });

      it('validates on update too', async () => {
        const project = await createTestProject(db, user.id);
        await auth(request(app).put(`/api/projects/${project.id}`))
          .send({ name: 'X', nodes: [null] })
          .expect(400);
      });
    });

    describe('versions', () => {
      const createViaApi = async () => {
        const res = await auth(request(app).post('/api/projects/create'))
          .send({ name: 'Versioned', nodes: [], edges: [] })
          .expect(201);
        return res.body.id;
      };

      const saveWithNodeCount = (id, n) => auth(request(app).put(`/api/projects/${id}`))
        .send({
          name: 'Versioned',
          nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, position: { x: i, y: 0 }, data: {} })),
          edges: []
        })
        .expect(200);

      it('creates version 1 on create and increments on save', async () => {
        const id = await createViaApi();
        await saveWithNodeCount(id, 1);
        await saveWithNodeCount(id, 2);
        const res = await auth(request(app).get(`/api/projects/${id}/versions`)).expect(200);
        expect(res.body.map(v => v.version_number)).toEqual([3, 2, 1]);
        expect(res.body.map(v => v.node_count)).toEqual([2, 1, 0]);
      });

      it('GET /:id/versions/:n returns one full version', async () => {
        const id = await createViaApi();
        await saveWithNodeCount(id, 3);
        const res = await auth(request(app).get(`/api/projects/${id}/versions/2`)).expect(200);
        expect(res.body.version_number).toBe(2);
        expect(res.body.nodes).toHaveLength(3);
        expect(Array.isArray(res.body.edges)).toBe(true);
      });

      it('GET /:id/versions/:n handles missing, invalid and foreign versions', async () => {
        const id = await createViaApi();
        await auth(request(app).get(`/api/projects/${id}/versions/99`)).expect(404);
        await auth(request(app).get(`/api/projects/${id}/versions/abc`)).expect(400);

        const other = await createTestUser(db, { email: 'other@example.com' });
        await request(app)
          .get(`/api/projects/${id}/versions/1`)
          .set('Authorization', `Bearer ${generateJWT(other.id, other.email)}`)
          .expect(403);
      });

      it(`keeps at most ${MAX_VERSIONS_PER_PROJECT} versions and keeps numbering with MAX()`, async () => {
        const id = await createViaApi();
        // Insert many versions directly (fast), then one save through the API
        for (let v = 2; v <= MAX_VERSIONS_PER_PROJECT + 9; v++) {
          await dbHelpers.createProjectVersion(db, { project_id: id, version_number: v, nodes: [], edges: [] });
        }
        await saveWithNodeCount(id, 1);

        const res = await auth(request(app).get(`/api/projects/${id}/versions`)).expect(200);
        expect(res.body).toHaveLength(MAX_VERSIONS_PER_PROJECT);
        expect(res.body[0].version_number).toBe(MAX_VERSIONS_PER_PROJECT + 10);
        expect(res.body[res.body.length - 1].version_number).toBe(11);

        // Next number comes from MAX(version_number), not from the count
        await saveWithNodeCount(id, 2);
        const after = await auth(request(app).get(`/api/projects/${id}/versions`)).expect(200);
        expect(after.body[0].version_number).toBe(MAX_VERSIONS_PER_PROJECT + 11);
        expect(after.body).toHaveLength(MAX_VERSIONS_PER_PROJECT);
      });

      it('restore creates a new version with the old graph', async () => {
        const id = await createViaApi();
        await saveWithNodeCount(id, 4);
        const res = await auth(request(app).post(`/api/projects/${id}/restore/1`)).expect(200);
        expect(res.body.nodes).toEqual([]);
        expect(res.body.metadata.restored_from_version).toBe(1);
        const versions = await auth(request(app).get(`/api/projects/${id}/versions`)).expect(200);
        expect(versions.body[0].version_number).toBe(3);
      });

      it('restore of a missing version returns 404 and changes nothing', async () => {
        const id = await createViaApi();
        await saveWithNodeCount(id, 2);
        await auth(request(app).post(`/api/projects/${id}/restore/42`)).expect(404);
        const project = await auth(request(app).get(`/api/projects/${id}`)).expect(200);
        expect(project.body.nodes).toHaveLength(2);
      });
    });
  });

  describe('withTransaction', () => {
    it('rolls back all writes when the callback throws', async () => {
      const user = await createTestUser(db, { email: 'tx@example.com' });
      await expect(withTransaction(db, async () => {
        await dbHelpers.createProject(db, { user_id: user.id, name: 'Half-written' });
        throw new Error('boom');
      })).rejects.toThrow('boom');
      const count = await db.get('SELECT COUNT(*) AS c FROM projects');
      expect(count.c).toBe(0);
    });

    it('serializes concurrent transactions on the same connection', async () => {
      const user = await createTestUser(db, { email: 'tx2@example.com' });
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => withTransaction(db, async () => {
          const r = await dbHelpers.createProject(db, { user_id: user.id, name: `P${i}` });
          await new Promise(resolve => setTimeout(resolve, 5));
          return r.lastID;
        }))
      );
      expect(new Set(results).size).toBe(5);
      const count = await db.get('SELECT COUNT(*) AS c FROM projects');
      expect(count.c).toBe(5);
    });

    it('concurrent saves produce distinct version numbers', async () => {
      const user = await createTestUser(db, { email: 'tx3@example.com' });
      const token = generateJWT(user.id, user.email);
      const created = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Race' })
        .expect(201);
      const id = created.body.id;

      await Promise.all(Array.from({ length: 4 }, (_, i) => request(app)
        .put(`/api/projects/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Race', nodes: [{ id: `n${i}`, position: { x: 0, y: 0 } }], edges: [] })
        .expect(200)));

      const rows = await db.all('SELECT version_number FROM project_versions WHERE project_id = ?', id);
      const numbers = rows.map(r => r.version_number);
      expect(new Set(numbers).size).toBe(numbers.length);
    });
  });
});
