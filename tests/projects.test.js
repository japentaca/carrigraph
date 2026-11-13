import request from 'supertest';
import { dbHelpers } from '../server/database.js';
import {
  createTestDatabase,
  createTestApp,
  createTestUser,
  createTestProject,
  generateJWT,
  cleanDatabase,
  expectValidProject,
  expectValidProjectSummary
} from './helpers.js';

describe('Projects API', () => {
  let app;
  let db;
  let testUser;
  let testUser2;
  let token;
  let token2;

  beforeAll(async () => {
    // Create test database
    db = await createTestDatabase();
    app = createTestApp(db);
  });

  beforeEach(async () => {
    await cleanDatabase(db);
    
    // Create test users
    testUser = await createTestUser(db, {
      name: 'Test User 1',
      email: 'user1@example.com'
    });
    
    testUser2 = await createTestUser(db, {
      name: 'Test User 2',
      email: 'user2@example.com'
    });
    
    token = generateJWT(testUser.id, testUser.email);
    token2 = generateJWT(testUser2.id, testUser2.email);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('GET /api/projects', () => {
    it('should return empty array when user has no projects', async () => {
      const response = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });

    it('should return user projects', async () => {
      // Create test projects
      await createTestProject(db, testUser.id, { name: 'Project 1' });
      await createTestProject(db, testUser.id, { name: 'Project 2' });
      await createTestProject(db, testUser2.id, { name: 'Other User Project' });

      const response = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      
      // Phase 1: the list returns summaries (no nodes/edges, with counts)
      response.body.forEach(project => {
        expectValidProjectSummary(project);
        expect(project.user_id).toBe(testUser.id);
        expect(project.node_count).toBe(2);
        expect(project.edge_count).toBe(1);
      });

      const projectNames = response.body.map(p => p.name);
      expect(projectNames).toContain('Project 1');
      expect(projectNames).toContain('Project 2');
      expect(projectNames).not.toContain('Other User Project');
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/projects')
        .expect(401);

      expect(response.body).toHaveProperty('message', 'Unauthorized');
    });
  });

  describe('GET /api/projects/:id', () => {
    let testProject;

    beforeEach(async () => {
      testProject = await createTestProject(db, testUser.id);
    });

    it('should return specific project', async () => {
      const response = await request(app)
        .get(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expectValidProject(response.body);
      expect(response.body.id).toBe(testProject.id);
      expect(response.body.name).toBe(testProject.name);
    });

    it('should return 400 for invalid project ID', async () => {
      const response = await request(app)
        .get('/api/projects/invalid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Invalid project ID');
    });

    it('should return 404 for non-existent project', async () => {
      const response = await request(app)
        .get('/api/projects/99999')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.body).toHaveProperty('message', 'Project not found');
    });

    it('should return 403 for project owned by another user', async () => {
      const response = await request(app)
        .get(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(403);

      expect(response.body).toHaveProperty('message', 'Access denied - you do not own this project');
    });
  });

  describe('POST /api/projects/create', () => {
    it('should create a new project successfully', async () => {
      const projectData = {
        name: 'New Project',
        description: 'A new test project',
        nodes: [
          { id: '1', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } },
          { id: '2', type: 'output', position: { x: 200, y: 0 }, data: { label: 'Output' } }
        ],
        edges: [
          { id: 'e1-2', source: '1', target: '2' }
        ],
        metadata: { custom: 'data' }
      };

      const response = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${token}`)
        .send(projectData)
        .expect(201);

      expect(response.body).toHaveProperty('message', 'Project created successfully');
      expectValidProject(response.body);
      expect(response.body.name).toBe(projectData.name);
      expect(response.body.description).toBe(projectData.description);
      expect(response.body.user_id).toBe(testUser.id);
      expect(response.body.nodes).toEqual(projectData.nodes);
      expect(response.body.edges).toEqual(projectData.edges);
      expect(response.body.metadata).toMatchObject({
        ...projectData.metadata,
        version: '1.0',
        created_by: testUser.id,
        node_count: 2,
        edge_count: 1
      });
    });

    it('should create project with minimal data', async () => {
      const projectData = {
        name: 'Minimal Project'
      };

      const response = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${token}`)
        .send(projectData)
        .expect(201);

      expectValidProject(response.body);
      expect(response.body.name).toBe(projectData.name);
      expect(response.body.description).toBeNull();
      expect(response.body.nodes).toEqual([]);
      expect(response.body.edges).toEqual([]);
    });

    it('should return 400 for missing name', async () => {
      const response = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'No name' })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Project name is required');
    });

    it('should return 400 for empty name', async () => {
      const response = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '   ' })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Project name is required');
    });

    it('should return 400 for name too long', async () => {
      const longName = 'a'.repeat(101);
      
      const response = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: longName })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Project name must be 100 characters or less');
    });

    it('should return 400 for description too long', async () => {
      const longDescription = 'a'.repeat(501);
      
      const response = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ 
          name: 'Test Project',
          description: longDescription
        })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Project description must be 500 characters or less');
    });

    it('should return 400 for invalid nodes/edges format', async () => {
      const response = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ 
          name: 'Test Project',
          nodes: 'not an array'
        })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Nodes and edges must be arrays');
    });
  });

  describe('PUT /api/projects/:id', () => {
    let testProject;

    beforeEach(async () => {
      testProject = await createTestProject(db, testUser.id);
    });

    it('should update project successfully', async () => {
      const updateData = {
        name: 'Updated Project',
        description: 'Updated description',
        nodes: [
          { id: '1', type: 'input', position: { x: 0, y: 0 }, data: { label: 'New Input' } }
        ],
        edges: [],
        metadata: { updated: true }
      };

      const response = await request(app)
        .put(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Project updated successfully');
      expectValidProject(response.body);
      expect(response.body.name).toBe(updateData.name);
      expect(response.body.description).toBe(updateData.description);
      expect(response.body.nodes).toEqual(updateData.nodes);
      expect(response.body.edges).toEqual(updateData.edges);
    });

    it('should return 400 for invalid project ID', async () => {
      const response = await request(app)
        .put('/api/projects/invalid')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated' })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Invalid project ID');
    });

    it('should return 404 for non-existent project', async () => {
      const response = await request(app)
        .put('/api/projects/99999')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated' })
        .expect(404);

      expect(response.body).toHaveProperty('message', 'Project not found');
    });

    it('should return 403 for project owned by another user', async () => {
      const response = await request(app)
        .put(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${token2}`)
        .send({ name: 'Updated' })
        .expect(403);

      expect(response.body).toHaveProperty('message', 'Access denied - you do not own this project');
    });

    it('should return 400 for missing name', async () => {
      const response = await request(app)
        .put(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'No name' })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Project name is required');
    });
  });

  describe('DELETE /api/projects/:id', () => {
    let testProject;

    beforeEach(async () => {
      testProject = await createTestProject(db, testUser.id);
    });

    it('should delete project successfully', async () => {
      const response = await request(app)
        .delete(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Project deleted successfully');

      // Verify project is deleted
      const deletedProject = await db.get('SELECT * FROM projects WHERE id = ?', testProject.id);
      expect(deletedProject).toBeUndefined();
    });

    it('should return 400 for invalid project ID', async () => {
      const response = await request(app)
        .delete('/api/projects/invalid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Invalid project ID');
    });

    it('should return 404 for non-existent project', async () => {
      const response = await request(app)
        .delete('/api/projects/99999')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.body).toHaveProperty('message', 'Project not found');
    });

    it('should return 403 for project owned by another user', async () => {
      const response = await request(app)
        .delete(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(403);

      expect(response.body).toHaveProperty('message', 'Access denied - you do not own this project');
    });
  });

  describe('POST /api/projects/:id/duplicate', () => {
    let testProject;

    beforeEach(async () => {
      testProject = await createTestProject(db, testUser.id, {
        name: 'Original Project',
        description: 'Original description'
      });
    });

    it('should duplicate project successfully', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Duplicated Project' })
        .expect(201);

      expect(response.body).toHaveProperty('message', 'Project duplicated successfully');
      expectValidProject(response.body);
      expect(response.body.name).toBe('Duplicated Project');
      expect(response.body.description).toBe('Copy of Original Project');
      expect(response.body.user_id).toBe(testUser.id);
      expect(response.body.nodes).toEqual(testProject.nodes);
      expect(response.body.edges).toEqual(testProject.edges);
      expect(response.body.metadata).toMatchObject({
        original_project_id: testProject.id
      });
    });

    it('should return 400 for missing name', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('message', 'New project name is required');
    });

    it('should return 404 for non-existent project', async () => {
      const response = await request(app)
        .post('/api/projects/99999/duplicate')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Duplicate' })
        .expect(404);

      expect(response.body).toHaveProperty('message', 'Project not found');
    });

    it('should return 403 for project owned by another user', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/duplicate`)
        .set('Authorization', `Bearer ${token2}`)
        .send({ name: 'Duplicate' })
        .expect(403);

      expect(response.body).toHaveProperty('message', 'Access denied - you do not own this project');
    });
  });

  describe('GET /api/projects/:id/versions', () => {
    let testProject;

    beforeEach(async () => {
      testProject = await createTestProject(db, testUser.id);
      
      // Create a version
      await dbHelpers.createProjectVersion(db, {
        project_id: testProject.id,
        version_number: 1,
        nodes: testProject.nodes,
        edges: testProject.edges,
        metadata: testProject.metadata
      });
    });

    it('should return project versions', async () => {
      const response = await request(app)
        .get(`/api/projects/${testProject.id}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      
      const version = response.body[0];
      expect(version).toHaveProperty('id');
      expect(version).toHaveProperty('project_id', testProject.id);
      expect(version).toHaveProperty('version_number', 1);
      // Phase 1: lightweight list (full version via GET /:id/versions/:n)
      expect(version).not.toHaveProperty('nodes');
      expect(version).not.toHaveProperty('edges');
      expect(version).toHaveProperty('node_count', 2);
      expect(version).toHaveProperty('edge_count', 1);
      expect(version).toHaveProperty('metadata');
      expect(version).toHaveProperty('created_at');
    });

    it('should return 404 for non-existent project', async () => {
      const response = await request(app)
        .get('/api/projects/99999/versions')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.body).toHaveProperty('message', 'Project not found');
    });

    it('should return 403 for project owned by another user', async () => {
      const response = await request(app)
        .get(`/api/projects/${testProject.id}/versions`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(403);

      expect(response.body).toHaveProperty('message', 'Access denied - you do not own this project');
    });
  });

  describe('POST /api/projects/:id/restore/:versionNumber', () => {
    let testProject;
    let versionId;

    beforeEach(async () => {
      testProject = await createTestProject(db, testUser.id);
      
      // Create versions
      const version1 = await dbHelpers.createProjectVersion(db, {
        project_id: testProject.id,
        version_number: 1,
        nodes: [{ id: '1', data: { label: 'Version 1' } }],
        edges: [],
        metadata: { version: 1 }
      });
      
      await dbHelpers.createProjectVersion(db, {
        project_id: testProject.id,
        version_number: 2,
        nodes: [{ id: '1', data: { label: 'Version 2' } }],
        edges: [],
        metadata: { version: 2 }
      });
      
      versionId = version1.lastID;
    });

    it('should restore project to specific version', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/restore/1`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Project restored to version 1');
      expectValidProject(response.body);
      expect(response.body.nodes[0].data.label).toBe('Version 1');
    });

    it('should return 400 for invalid version number', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/restore/invalid`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Invalid project ID or version number');
    });

    it('should return 404 for non-existent version', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/restore/99`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.body).toHaveProperty('message', 'Version not found');
    });

    it('should return 403 for project owned by another user', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProject.id}/restore/1`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(403);

      expect(response.body).toHaveProperty('message', 'Access denied - you do not own this project');
    });
  });
});