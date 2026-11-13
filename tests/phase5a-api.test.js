// Fase 5A: share links, public gallery, profile (change password / delete account).
import request from 'supertest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initializeDatabase } from '../server/database.js';
import { generateShareToken } from '../server/routes/projects.js';
import {
  createTestDatabase,
  createTestApp,
  createTestUser,
  createTestProject,
  generateJWT,
  cleanDatabase
} from './helpers.js';

// Two tracks (schema 3): pattern → voice → output, twice.
const track = (n) => ([
  { id: `p${n}`, type: 'pattern', position: { x: 0, y: n * 200 }, data: { algorithm: 'euclidean', density: 0.5, seed: 7 } },
  { id: `v${n}`, type: 'voice', position: { x: 300, y: n * 200 }, data: { instrument: 'Synth' } },
  { id: `o${n}`, type: 'output', position: { x: 600, y: n * 200 }, data: { volume: 1, pan: 0, mute: false, solo: false } }
]);
const trackEdges = (n) => ([
  { id: `e${n}a`, source: `p${n}`, target: `v${n}`, sourceHandle: 'pattern', targetHandle: 'notes' },
  { id: `e${n}b`, source: `v${n}`, target: `o${n}`, sourceHandle: 'audio', targetHandle: 'audio' }
]);
const twoTracks = {
  nodes: [...track(1), ...track(2)],
  edges: [...trackEdges(1), ...trackEdges(2)],
  metadata: { schemaVersion: 3, tempo: 96, swing: 0.25, created_by: 1, last_modified_by: 1, secret_note: 'x' }
};

// Schema 1 project: no seed, edge stored backwards with old handle ids.
const oldFormat = {
  nodes: [
    { id: 'pat', type: 'pattern', position: { x: 0, y: 0 }, data: { algorithm: 'euclidean', density: 0.5 } },
    { id: 'voi', type: 'voice', position: { x: 300, y: 0 }, data: { instrument: 'Bass', effects: ['reverb'] } }
  ],
  edges: [{ id: 'old', source: 'voi', target: 'pat', sourceHandle: 'voice-input', targetHandle: 'pattern-output' }],
  metadata: {}
};

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

describe('Fase 5A — compartir, galería y perfil', () => {
  let app;
  let db;
  let owner;
  let other;
  let ownerToken;
  let otherToken;
  const as = (req, token) => req.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);
  });

  beforeEach(async () => {
    await cleanDatabase(db);
    await db.exec('DELETE FROM project_shares');
    owner = await createTestUser(db, { name: 'Ana Dueña', email: 'ana@example.com' });
    other = await createTestUser(db, { name: 'Beto', email: 'beto@example.com' });
    ownerToken = generateJWT(owner.id, owner.email);
    otherToken = generateJWT(other.id, other.email);
  });

  afterAll(async () => {
    await db.close();
  });

  const share = (projectId, token = ownerToken) =>
    as(request(app).post(`/api/projects/${projectId}/share`), token);

  // ---------------------------------------------------------------------------
  describe('enlace compartido (dueño)', () => {
    it('creates a random 32-char token; a second POST returns the same link', async () => {
      const p = await createTestProject(db, owner.id, twoTracks);
      const first = await share(p.id).expect(201);
      expect(first.body.share.token).toMatch(TOKEN_RE);
      expect(first.body.share.path).toBe(`/s/${first.body.share.token}`);
      const again = await share(p.id).expect(200);
      expect(again.body.share.token).toBe(first.body.share.token);

      const status = await as(request(app).get(`/api/projects/${p.id}/share`), ownerToken).expect(200);
      expect(status.body).toMatchObject({ share: { token: first.body.share.token }, is_public: false });
    });

    it('tokens come from a CSPRNG and do not repeat', () => {
      const tokens = new Set(Array.from({ length: 500 }, () => generateShareToken()));
      expect(tokens.size).toBe(500);
      for (const t of tokens) expect(t).toMatch(TOKEN_RE);
    });

    it('the project list (owner) says whether it is shared and public', async () => {
      const p = await createTestProject(db, owner.id, twoTracks);
      const { body: { share: s } } = await share(p.id);
      const list = await as(request(app).get('/api/projects'), ownerToken).expect(200);
      expect(list.body[0]).toMatchObject({ id: p.id, share_token: s.token, is_public: 0 });
      expect(list.body[0]).not.toHaveProperty('nodes');
    });

    it('revoking makes the token 404 right away; a new link gets a new token', async () => {
      const p = await createTestProject(db, owner.id, twoTracks);
      const { body: { share: s } } = await share(p.id);
      await request(app).get(`/api/shared/${s.token}`).expect(200);

      const del = await as(request(app).delete(`/api/projects/${p.id}/share`), ownerToken).expect(200);
      expect(del.body.revoked).toBe(true);
      await request(app).get(`/api/shared/${s.token}`).expect(404);

      const again = await share(p.id).expect(201);
      expect(again.body.share.token).not.toBe(s.token);
      await request(app).get(`/api/shared/${s.token}`).expect(404);
      await request(app).get(`/api/shared/${again.body.share.token}`).expect(200);

      // Revoking twice is harmless
      await as(request(app).delete(`/api/projects/${p.id}/share`), ownerToken).expect(200);
      const third = await as(request(app).delete(`/api/projects/${p.id}/share`), ownerToken).expect(200);
      expect(third.body.revoked).toBe(false);
    });

    it('nonexistent or malformed tokens give 404', async () => {
      await request(app).get(`/api/shared/${generateShareToken()}`).expect(404);
      await request(app).get('/api/shared/abc').expect(404);
      await request(app).get(`/api/shared/${'x'.repeat(33)}`).expect(404);
      await request(app).get("/api/shared/' OR 1=1 --").expect(404);
    });

    it('deleting the project kills its link', async () => {
      const p = await createTestProject(db, owner.id, twoTracks);
      const { body: { share: s } } = await share(p.id);
      await as(request(app).delete(`/api/projects/${p.id}`), ownerToken).expect(200);
      await request(app).get(`/api/shared/${s.token}`).expect(404);
      expect(await db.get('SELECT COUNT(*) AS n FROM project_shares')).toEqual({ n: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  describe('seguridad: proyectos ajenos', () => {
    it('another user cannot create, read, revoke a link nor publish', async () => {
      const p = await createTestProject(db, owner.id, twoTracks);
      const { body: { share: s } } = await share(p.id);

      await share(p.id, otherToken).expect(403);
      await as(request(app).get(`/api/projects/${p.id}/share`), otherToken).expect(403);
      await as(request(app).delete(`/api/projects/${p.id}/share`), otherToken).expect(403);
      await as(request(app).put(`/api/projects/${p.id}/public`), otherToken).send({ public: true }).expect(403);

      // Nothing changed
      await request(app).get(`/api/shared/${s.token}`).expect(200);
      expect((await db.get('SELECT is_public FROM projects WHERE id = ?', p.id)).is_public).toBe(0);
      const gallery = await request(app).get('/api/gallery').expect(200);
      expect(gallery.body.items).toHaveLength(0);
    });

    it('without a session: 401; unknown project: 404; bad id: 400', async () => {
      const p = await createTestProject(db, owner.id, twoTracks);
      await request(app).post(`/api/projects/${p.id}/share`).expect(401);
      await request(app).delete(`/api/projects/${p.id}/share`).expect(401);
      await request(app).put(`/api/projects/${p.id}/public`).send({ public: true }).expect(401);
      await share(99999).expect(404);
      await share('12abc').expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('GET /api/shared/:token (público)', () => {
    it('works without a session and does not leak private fields', async () => {
      const p = await createTestProject(db, owner.id, {
        ...twoTracks,
        nodes: twoTracks.nodes.map((n, i) => (i === 0 ? { ...n, selected: true, computedPosition: { x: 1, y: 2 }, dimensions: { width: 9 } } : n))
      });
      const { body: { share: s } } = await share(p.id);
      const res = await request(app).get(`/api/shared/${s.token}`).expect(200);

      expect(Object.keys(res.body).sort()).toEqual(['author', 'project']);
      expect(res.body.author).toEqual({ name: 'Ana Dueña' });
      expect(Object.keys(res.body.project).sort()).toEqual(
        ['created_at', 'description', 'edges', 'metadata', 'name', 'nodes', 'track_count', 'updated_at']);
      expect(res.body.project.metadata).toEqual({ schemaVersion: 3, tempo: 96, swing: 0.25 });
      expect(res.body.project.track_count).toBe(2);
      for (const n of res.body.project.nodes) {
        expect(Object.keys(n).sort()).toEqual(['data', 'id', 'position', 'type']);
      }
      const text = JSON.stringify(res.body);
      for (const secret of ['ana@example.com', 'user_id', 'created_by', 'last_modified_by', 'secret_note', 'password', `"id":${p.id}`]) {
        expect(text).not.toContain(secret);
      }
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('always shows the current version of the project', async () => {
      const p = await createTestProject(db, owner.id, twoTracks);
      const { body: { share: s } } = await share(p.id);
      await as(request(app).put(`/api/projects/${p.id}`), ownerToken)
        .send({ name: 'Renombrado', nodes: track(1), edges: trackEdges(1) })
        .expect(200);
      const res = await request(app).get(`/api/shared/${s.token}`).expect(200);
      expect(res.body.project.name).toBe('Renombrado');
      expect(res.body.project.nodes).toHaveLength(3);
      expect(res.body.project.track_count).toBe(1);
    });

    it('old projects are served through migrateProject', async () => {
      const p = await createTestProject(db, owner.id, oldFormat);
      const { body: { share: s } } = await share(p.id);
      const res = await request(app).get(`/api/shared/${s.token}`).expect(200);
      const { nodes, edges, metadata } = res.body.project;
      expect(metadata.schemaVersion).toBe(3);
      expect(typeof nodes.find(n => n.id === 'pat').data.seed).toBe('number');
      expect(nodes.find(n => n.id === 'voi').data).not.toHaveProperty('effects');
      // Edge re-oriented with typed ports
      expect(edges[0]).toMatchObject({ source: 'pat', target: 'voi', sourceHandle: 'pattern', targetHandle: 'notes' });
      expect(res.body.project.track_count).toBe(1);
      // The stored project is not modified by reading it
      const stored = await db.get('SELECT edges FROM projects WHERE id = ?', p.id);
      expect(JSON.parse(stored.edges)[0].source).toBe('voi');
    });

    it('content that fails the shape check is not served (422, nothing leaked)', async () => {
      const bad = [
        ['{"not":"an array"}', '[]'],
        ['[{"type":"pattern"}]', '[]'],
        ['[{"id":"a","position":{"x":"1","y":0}}]', '[]'],
        ['[{"id":"a"}]', '[{"source":"a"}]']
      ];
      for (const [nodes, edges] of bad) {
        await cleanDatabase(db);
        const u = await createTestUser(db, { email: 'bad@example.com' });
        const r = await db.run('INSERT INTO projects (user_id, name, nodes, edges) VALUES (?, ?, ?, ?)', u.id, 'Malo', nodes, edges);
        await db.run('INSERT INTO project_shares (project_id, token) VALUES (?, ?)', r.lastID, 'A'.repeat(32));
        const res = await request(app).get(`/api/shared/${'A'.repeat(32)}`).expect(422);
        expect(res.body).toEqual({ message: expect.any(String) });
        await db.exec('DELETE FROM project_shares');
      }
    });

    it('edge styles are reduced to a validated stroke color', async () => {
      const p = await createTestProject(db, owner.id, {
        ...twoTracks,
        edges: twoTracks.edges.map((e, i) => ({
          ...e,
          style: i === 0 ? { stroke: '#f59e0b', background: 'url(http://evil)' } : { stroke: 'url(http://evil)' },
          sourceNode: { huge: true }
        }))
      });
      const { body: { share: s } } = await share(p.id);
      const res = await request(app).get(`/api/shared/${s.token}`).expect(200);
      expect(res.body.project.edges[0].style).toEqual({ stroke: '#f59e0b', strokeWidth: 2 });
      expect(res.body.project.edges[1]).not.toHaveProperty('style');
      expect(JSON.stringify(res.body)).not.toContain('evil');
      expect(res.body.project.edges[0]).not.toHaveProperty('sourceNode');
    });
  });

  // ---------------------------------------------------------------------------
  describe('hacer una copia', () => {
    it('a signed-in user copies a shared project into their own projects', async () => {
      const p = await createTestProject(db, owner.id, twoTracks);
      const { body: { share: s } } = await share(p.id);
      await request(app).post(`/api/shared/${s.token}/copy`).expect(401);

      const res = await as(request(app).post(`/api/shared/${s.token}/copy`), otherToken).expect(201);
      expect(res.body.user_id).toBe(other.id);
      expect(res.body.name).toBe('Test Project (copia)');
      expect(res.body.nodes).toHaveLength(6);
      expect(res.body.metadata).toMatchObject({ schemaVersion: 3, tempo: 96, swing: 0.25, copied_from: 'shared', created_by: other.id });
      expect(res.body.metadata).not.toHaveProperty('secret_note');
      expect(res.body.is_public).toBe(0);
      const versions = await as(request(app).get(`/api/projects/${res.body.id}/versions`), otherToken).expect(200);
      expect(versions.body).toHaveLength(1);
      // Owned by the copier, independent from the original
      await as(request(app).get(`/api/projects/${res.body.id}`), otherToken).expect(200);
      await as(request(app).get(`/api/projects/${res.body.id}`), ownerToken).expect(403);
      expect(await db.get('SELECT COUNT(*) AS n FROM project_shares')).toEqual({ n: 1 });
    });

    it('a revoked link cannot be copied', async () => {
      const p = await createTestProject(db, owner.id, twoTracks);
      const { body: { share: s } } = await share(p.id);
      await as(request(app).delete(`/api/projects/${p.id}/share`), ownerToken);
      await as(request(app).post(`/api/shared/${s.token}/copy`), otherToken).expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe('galería pública', () => {
    const publish = (id, value = true, token = ownerToken) =>
      as(request(app).put(`/api/projects/${id}/public`), token).send({ public: value });

    it('lists only public projects with name, author, tracks and date (no private fields)', async () => {
      const pub = await createTestProject(db, owner.id, { ...twoTracks, name: 'Público' });
      await createTestProject(db, owner.id, { ...twoTracks, name: 'Privado' });
      const r = await publish(pub.id).expect(200);
      expect(r.body).toMatchObject({ id: pub.id, is_public: true });
      expect(r.body.published_at).toBeTruthy();

      const res = await request(app).get('/api/gallery').expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 12, total: 1, pages: 1 });
      expect(res.body.items).toHaveLength(1);
      const item = res.body.items[0];
      expect(Object.keys(item).sort()).toEqual(['author', 'description', 'id', 'name', 'published_at', 'track_count', 'updated_at']);
      expect(item).toMatchObject({ id: pub.id, name: 'Público', author: 'Ana Dueña', track_count: 2 });
      expect(JSON.stringify(res.body)).not.toContain('ana@example.com');

      const one = await request(app).get(`/api/gallery/${pub.id}`).expect(200);
      expect(one.body.id).toBe(pub.id);
      expect(one.body.author).toEqual({ name: 'Ana Dueña' });
      expect(one.body.project.metadata).toEqual({ schemaVersion: 3, tempo: 96, swing: 0.25 });
      expect(JSON.stringify(one.body)).not.toContain('secret_note');
    });

    it('a project disappears as soon as it is unmarked or deleted', async () => {
      const a = await createTestProject(db, owner.id, { ...twoTracks, name: 'A' });
      const b = await createTestProject(db, owner.id, { ...twoTracks, name: 'B' });
      await publish(a.id);
      await publish(b.id);
      expect((await request(app).get('/api/gallery')).body.total).toBe(2);

      await publish(a.id, false).expect(200);
      let res = await request(app).get('/api/gallery');
      expect(res.body.items.map(i => i.name)).toEqual(['B']);
      await request(app).get(`/api/gallery/${a.id}`).expect(404);

      await as(request(app).delete(`/api/projects/${b.id}`), ownerToken).expect(200);
      res = await request(app).get('/api/gallery');
      expect(res.body).toMatchObject({ total: 0, items: [] });
      await request(app).get(`/api/gallery/${b.id}`).expect(404);
    });

    it('paginates, newest publication first, with a capped limit', async () => {
      for (let i = 1; i <= 5; i++) {
        const p = await createTestProject(db, owner.id, { ...twoTracks, name: `P${i}` });
        await publish(p.id);
        await db.run('UPDATE projects SET published_at = ? WHERE id = ?', `2026-01-0${i} 10:00:00.000`, p.id);
      }
      const page1 = await request(app).get('/api/gallery?limit=2').expect(200);
      expect(page1.body).toMatchObject({ page: 1, limit: 2, total: 5, pages: 3 });
      expect(page1.body.items.map(i => i.name)).toEqual(['P5', 'P4']);
      const page3 = await request(app).get('/api/gallery?limit=2&page=3').expect(200);
      expect(page3.body.items.map(i => i.name)).toEqual(['P1']);
      const beyond = await request(app).get('/api/gallery?limit=2&page=9').expect(200);
      expect(beyond.body.items).toEqual([]);
      const capped = await request(app).get('/api/gallery?limit=5000&page=-3').expect(200);
      expect(capped.body).toMatchObject({ page: 1, limit: 48 });
    });

    it('publish needs a boolean; republishing keeps the first publication date', async () => {
      const p = await createTestProject(db, owner.id, twoTracks);
      await publish(p.id, 'yes').expect(400);
      const first = await publish(p.id).expect(200);
      const again = await publish(p.id).expect(200);
      expect(again.body.published_at).toBe(first.body.published_at);
    });

    it('publishing does not change updated_at (no false save conflict in the editor)', async () => {
      const created = await as(request(app).post('/api/projects/create'), ownerToken)
        .send({ name: 'Edit', nodes: twoTracks.nodes, edges: twoTracks.edges }).expect(201);
      const base = created.body.updated_at;
      const r = await publish(created.body.id).expect(200);
      expect(r.body.updated_at).toBe(base);
      await as(request(app).put(`/api/projects/${created.body.id}`), ownerToken)
        .send({ name: 'Edit', nodes: track(1), edges: trackEdges(1), base_updated_at: base })
        .expect(200);
      // still public after a save
      expect((await request(app).get('/api/gallery')).body.total).toBe(1);
    });

    it('copy from the gallery (auth) and 404 for private projects', async () => {
      const p = await createTestProject(db, owner.id, twoTracks);
      await request(app).get(`/api/gallery/${p.id}`).expect(404);
      await as(request(app).post(`/api/gallery/${p.id}/copy`), otherToken).expect(404);
      await publish(p.id);
      await request(app).post(`/api/gallery/${p.id}/copy`).expect(401);
      const res = await as(request(app).post(`/api/gallery/${p.id}/copy`), otherToken).expect(201);
      expect(res.body).toMatchObject({ user_id: other.id, is_public: 0 });
      expect(res.body.metadata.copied_from).toBe('gallery');
      await request(app).get('/api/gallery/abc').expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe('límite de tasa de los endpoints públicos', () => {
    it('returns 429 after the configured number of requests', async () => {
      const limited = createTestApp(db, { publicRateLimit: { windowMs: 60_000, max: 2 } });
      await request(limited).get('/api/gallery').expect(200);
      await request(limited).get(`/api/shared/${generateShareToken()}`).expect(404);
      const res = await request(limited).get('/api/gallery').expect(429);
      expect(res.body.message).toMatch(/Demasiados/);
      await request(limited).get(`/api/shared/${generateShareToken()}`).expect(429);
      // Authenticated API is not affected
      await as(request(limited).get('/api/projects'), ownerToken).expect(200);
    });

    it('is off in tests by default (createTestApp)', async () => {
      for (let i = 0; i < 5; i++) await request(app).get('/api/gallery').expect(200);
    });

    it('also limits change-password and account deletion when credential limits are on', async () => {
      const limited = createTestApp(db, { rateLimit: { windowMs: 60_000, max: 1 } });
      await as(request(limited).put('/api/change-password'), ownerToken).send({}).expect(400);
      await as(request(limited).put('/api/change-password'), ownerToken).send({}).expect(429);
      await as(request(limited).delete('/api/account'), ownerToken).send({}).expect(400);
      await as(request(limited).delete('/api/account'), ownerToken).send({}).expect(429);
    });
  });

  // ---------------------------------------------------------------------------
  describe('perfil', () => {
    it('change-password requires 8+ characters and the current password', async () => {
      await as(request(app).put('/api/change-password'), ownerToken)
        .send({ currentPassword: 'password123', newPassword: '1234567' }).expect(400);
      await as(request(app).put('/api/change-password'), ownerToken)
        .send({ currentPassword: 'wrong-password', newPassword: 'nueva-clave-1' }).expect(401);
      await as(request(app).put('/api/change-password'), ownerToken)
        .send({ currentPassword: 'password123', newPassword: 'nueva-clave-1' }).expect(200);
      await request(app).post('/api/login').send({ email: 'ana@example.com', password: 'password123' }).expect(401);
      await request(app).post('/api/login').send({ email: 'ana@example.com', password: 'nueva-clave-1' }).expect(200);
    });

    it('delete account: wrong password deletes nothing', async () => {
      await createTestProject(db, owner.id, twoTracks);
      await as(request(app).delete('/api/account'), ownerToken).send({ password: 'nope-nope' }).expect(401);
      await as(request(app).delete('/api/account'), ownerToken).send({}).expect(400);
      expect(await db.get('SELECT COUNT(*) AS n FROM users WHERE id = ?', owner.id)).toEqual({ n: 1 });
      expect(await db.get('SELECT COUNT(*) AS n FROM projects')).toEqual({ n: 1 });
    });

    const seedOwnerData = async () => {
      const created = await as(request(app).post('/api/projects/create'), ownerToken)
        .send({ name: 'Mío', nodes: twoTracks.nodes, edges: twoTracks.edges }).expect(201);
      await as(request(app).put(`/api/projects/${created.body.id}`), ownerToken)
        .send({ name: 'Mío', nodes: track(1), edges: trackEdges(1) }).expect(200);
      const { body: { share: s } } = await share(created.body.id);
      await as(request(app).put(`/api/projects/${created.body.id}/public`), ownerToken).send({ public: true });
      const othersProject = await as(request(app).post('/api/projects/create'), otherToken)
        .send({ name: 'De Beto', nodes: twoTracks.nodes, edges: twoTracks.edges }).expect(201);
      const othersShare = await share(othersProject.body.id, otherToken).expect(201);
      return { projectId: created.body.id, token: s.token, othersProject: othersProject.body.id, othersToken: othersShare.body.share.token };
    };

    const expectOwnerGone = async ({ projectId, token, othersProject, othersToken }) => {
      expect(await db.get('SELECT COUNT(*) AS n FROM users WHERE id = ?', owner.id)).toEqual({ n: 0 });
      expect(await db.get('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?', owner.id)).toEqual({ n: 0 });
      expect(await db.get('SELECT COUNT(*) AS n FROM project_versions WHERE project_id = ?', projectId)).toEqual({ n: 0 });
      expect(await db.get('SELECT COUNT(*) AS n FROM project_shares WHERE project_id = ?', projectId)).toEqual({ n: 0 });
      await request(app).get(`/api/shared/${token}`).expect(404);
      expect((await request(app).get('/api/gallery')).body.total).toBe(0);
      // The other user's data is intact
      expect(await db.get('SELECT COUNT(*) AS n FROM projects WHERE id = ?', othersProject)).toEqual({ n: 1 });
      expect(await db.get('SELECT COUNT(*) AS n FROM project_versions WHERE project_id = ?', othersProject)).toEqual({ n: 1 });
      await request(app).get(`/api/shared/${othersToken}`).expect(200);
      // The old token no longer authenticates
      await as(request(app).get('/api/me'), ownerToken).expect(401);
    };

    it('delete account with the password removes projects, versions and links', async () => {
      const data = await seedOwnerData();
      expect(await db.get('SELECT COUNT(*) AS n FROM project_versions WHERE project_id = ?', data.projectId)).toEqual({ n: 2 });
      await as(request(app).delete('/api/account'), ownerToken).send({ password: 'password123' }).expect(200);
      await expectOwnerGone(data);
    });

    it('the cascade does not depend on foreign keys being enforced', async () => {
      const data = await seedOwnerData();
      await db.exec('PRAGMA foreign_keys = OFF');
      try {
        await as(request(app).delete('/api/account'), ownerToken).send({ password: 'password123' }).expect(200);
      } finally {
        await db.exec('PRAGMA foreign_keys = ON');
      }
      await expectOwnerGone(data);
    });
  });
});

// -----------------------------------------------------------------------------
describe('Fase 5A — migración del esquema', () => {
  it('adds project_shares and the gallery columns to an existing database file, keeping rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-5a-'));
    const file = join(dir, 'old.db');
    try {
      // A database as it was before Fase 5A
      const db = await initializeDatabase(file, { silent: true });
      await db.exec(`
        DROP TABLE project_shares;
        DROP INDEX idx_projects_public;
        ALTER TABLE projects DROP COLUMN published_at;
        ALTER TABLE projects DROP COLUMN is_public;
      `);
      const u = await db.run("INSERT INTO users (name, email, password) VALUES ('a', 'a@a.com', 'x')");
      const r = await db.run("INSERT INTO projects (user_id, name, nodes) VALUES (?, 'p', '[]')", u.lastID);
      await db.close();

      const db2 = await initializeDatabase(file, { silent: true });
      const cols = (await db2.all('PRAGMA table_info(projects)')).map(c => c.name);
      expect(cols).toEqual(expect.arrayContaining(['is_public', 'published_at']));
      expect(await db2.get('SELECT name, is_public, published_at FROM projects WHERE id = ?', r.lastID))
        .toEqual({ name: 'p', is_public: 0, published_at: null });
      expect(await db2.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_shares'"))
        .toEqual({ name: 'project_shares' });
      await db2.close();

      // Opening it again is a no-op
      const db3 = await initializeDatabase(file, { silent: true });
      await db3.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
