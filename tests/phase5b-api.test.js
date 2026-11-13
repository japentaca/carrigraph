// Fase 5B: performance macros travel in project metadata; public copies do not expose them.
import request from 'supertest';
import {
  createTestDatabase,
  createTestApp,
  createTestUser,
  createTestProject,
  generateJWT,
  cleanDatabase
} from './helpers.js';

const macros = [
  { id: 'm1', name: 'Filtro', value: 0.4, targets: [{ nodeId: 'fx', path: 'filter.cutoff' }] },
  { id: 'm2', name: 'Macro 2', value: 0.5, targets: [] }
];

describe('Fase 5B — macros en el proyecto', () => {
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
    user = await createTestUser(db, { email: 'macros@test.com' });
    token = generateJWT(user.id, user.email);
  });

  afterAll(async () => {
    await db.close();
  });

  it('saves macros with the project, keeps them on later saves and clears them with null', async () => {
    const project = await createTestProject(db, user.id);
    await auth(request(app).put(`/api/projects/${project.id}`))
      .send({ name: project.name, metadata: { tempo: 110, macros } })
      .expect(200);
    let res = await auth(request(app).get(`/api/projects/${project.id}`)).expect(200);
    expect(res.body.metadata.macros).toEqual(macros);

    // a save without the key (metadata is merged) keeps them
    await auth(request(app).put(`/api/projects/${project.id}`))
      .send({ name: project.name, metadata: { tempo: 120 } })
      .expect(200);
    res = await auth(request(app).get(`/api/projects/${project.id}`)).expect(200);
    expect(res.body.metadata.macros).toEqual(macros);
    expect(res.body.metadata.tempo).toBe(120);

    // the editor sends null to clear them
    await auth(request(app).put(`/api/projects/${project.id}`))
      .send({ name: project.name, metadata: { macros: null } })
      .expect(200);
    res = await auth(request(app).get(`/api/projects/${project.id}`)).expect(200);
    expect(res.body.metadata.macros).toBe(null);
  });

  it('a shared link does not expose the macros (public metadata whitelist)', async () => {
    const project = await createTestProject(db, user.id);
    await auth(request(app).put(`/api/projects/${project.id}`))
      .send({ name: project.name, metadata: { macros } })
      .expect(200);
    const share = await auth(request(app).post(`/api/projects/${project.id}/share`)).expect(201);
    const res = await request(app).get(`/api/shared/${share.body.share.token}`).expect(200);
    expect(res.body.project.metadata).not.toHaveProperty('macros');
  });
});
