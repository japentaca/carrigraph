import request from 'supertest';
import { dbHelpers } from '../server/database.js';
import {
  createTestDatabase,
  createTestApp,
  cleanDatabase,
  expectValidUser,
  expectValidProject,
  expectValidJWT
} from './helpers.js';

describe('Integration Tests', () => {
  let app;
  let db;

  beforeAll(async () => {
    // Create test database
    db = await createTestDatabase();
    app = createTestApp(db);
  });

  beforeEach(async () => {
    await cleanDatabase(db);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'OK');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('version', '1.0.0');
    });
  });

  describe('Complete User Journey', () => {
    it('should handle complete user registration and project management flow', async () => {
      // 1. Register a new user
      const registerResponse = await request(app)
        .post('/api/register')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'password123'
        })
        .expect(201);

      expect(registerResponse.body).toHaveProperty('message', 'User registered successfully');
      expect(registerResponse.body).toHaveProperty('token');
      expect(registerResponse.body).toHaveProperty('user');
      expectValidUser(registerResponse.body.user);
      expectValidJWT(registerResponse.body.token);

      const { token, user } = registerResponse.body;

      // 2. Verify token works
      const meResponse = await request(app)
        .get('/api/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(meResponse.body.user.id).toBe(user.id);

      // 3. Create a project
      const createProjectResponse = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'My First Project',
          description: 'A test project for integration testing',
          nodes: [
            { id: '1', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input Node' } },
            { id: '2', type: 'process', position: { x: 200, y: 0 }, data: { label: 'Process Node' } },
            { id: '3', type: 'output', position: { x: 400, y: 0 }, data: { label: 'Output Node' } }
          ],
          edges: [
            { id: 'e1-2', source: '1', target: '2' },
            { id: 'e2-3', source: '2', target: '3' }
          ],
          metadata: { category: 'test', complexity: 'simple' }
        })
        .expect(201);

      expect(createProjectResponse.body).toHaveProperty('message', 'Project created successfully');
      expectValidProject(createProjectResponse.body);
      expect(createProjectResponse.body.name).toBe('My First Project');
      expect(createProjectResponse.body.nodes).toHaveLength(3);
      expect(createProjectResponse.body.edges).toHaveLength(2);

      const projectId = createProjectResponse.body.id;

      // 4. Get all projects
      const getProjectsResponse = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(getProjectsResponse.body)).toBe(true);
      expect(getProjectsResponse.body).toHaveLength(1);
      expect(getProjectsResponse.body[0].id).toBe(projectId);

      // 5. Get specific project
      const getProjectResponse = await request(app)
        .get(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expectValidProject(getProjectResponse.body);
      expect(getProjectResponse.body.id).toBe(projectId);

      // 6. Update the project
      const updateProjectResponse = await request(app)
        .put(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Updated Project Name',
          description: 'Updated description',
          nodes: [
            { id: '1', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Updated Input' } },
            { id: '4', type: 'new', position: { x: 100, y: 100 }, data: { label: 'New Node' } }
          ],
          edges: [
            { id: 'e1-4', source: '1', target: '4' }
          ],
          metadata: { updated: true }
        })
        .expect(200);

      expect(updateProjectResponse.body).toHaveProperty('message', 'Project updated successfully');
      expect(updateProjectResponse.body.name).toBe('Updated Project Name');
      expect(updateProjectResponse.body.nodes).toHaveLength(2);
      expect(updateProjectResponse.body.edges).toHaveLength(1);

      // 7. Get project versions
      const getVersionsResponse = await request(app)
        .get(`/api/projects/${projectId}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(getVersionsResponse.body)).toBe(true);
      expect(getVersionsResponse.body.length).toBeGreaterThan(0);

      // 8. Duplicate the project
      const duplicateResponse = await request(app)
        .post(`/api/projects/${projectId}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Duplicated Project' })
        .expect(201);

      expect(duplicateResponse.body).toHaveProperty('message', 'Project duplicated successfully');
      expect(duplicateResponse.body.name).toBe('Duplicated Project');
      expect(duplicateResponse.body.description).toBe('Copy of Updated Project Name');
      expect(duplicateResponse.body.id).not.toBe(projectId);

      const duplicatedProjectId = duplicateResponse.body.id;

      // 9. Verify we now have 2 projects
      const getAllProjectsResponse = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(getAllProjectsResponse.body).toHaveLength(2);

      // 10. Delete the duplicated project
      const deleteResponse = await request(app)
        .delete(`/api/projects/${duplicatedProjectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(deleteResponse.body).toHaveProperty('message', 'Project deleted successfully');

      // 11. Verify only original project remains
      const finalProjectsResponse = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(finalProjectsResponse.body).toHaveLength(1);
      expect(finalProjectsResponse.body[0].id).toBe(projectId);

      // 12. Update user profile
      const updateProfileResponse = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'John Updated Doe',
          email: 'john.updated@example.com'
        })
        .expect(200);

      expect(updateProfileResponse.body).toHaveProperty('message', 'Profile updated successfully');
      expect(updateProfileResponse.body.user.name).toBe('John Updated Doe');
      expect(updateProfileResponse.body.user.email).toBe('john.updated@example.com');

      // 13. Change password
      const changePasswordResponse = await request(app)
        .put('/api/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'password123',
          newPassword: 'newpassword123'
        })
        .expect(200);

      expect(changePasswordResponse.body).toHaveProperty('message', 'Password changed successfully');

      // 14. Login with new password
      const loginResponse = await request(app)
        .post('/api/login')
        .send({
          email: 'john.updated@example.com',
          password: 'newpassword123'
        })
        .expect(200);

      expect(loginResponse.body).toHaveProperty('message', 'Login successful');
      expect(loginResponse.body).toHaveProperty('token');
      expectValidJWT(loginResponse.body.token);

      // 15. Logout
      const logoutResponse = await request(app)
        .get('/api/logout')
        .expect(200);

      expect(logoutResponse.body).toHaveProperty('message', 'Logout successful');
    });
  });

  describe('Multi-User Scenarios', () => {
    it('should handle multiple users with isolated data', async () => {
      // Register first user
      const user1Response = await request(app)
        .post('/api/register')
        .send({
          name: 'User One',
          email: 'user1@example.com',
          password: 'password123'
        })
        .expect(201);

      const user1Token = user1Response.body.token;
      const user1Id = user1Response.body.user.id;

      // Register second user
      const user2Response = await request(app)
        .post('/api/register')
        .send({
          name: 'User Two',
          email: 'user2@example.com',
          password: 'password123'
        })
        .expect(201);

      const user2Token = user2Response.body.token;
      const user2Id = user2Response.body.user.id;

      // User 1 creates a project
      const user1ProjectResponse = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'User 1 Project',
          description: 'Project by user 1'
        })
        .expect(201);

      const user1ProjectId = user1ProjectResponse.body.id;

      // User 2 creates a project
      const user2ProjectResponse = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          name: 'User 2 Project',
          description: 'Project by user 2'
        })
        .expect(201);

      const user2ProjectId = user2ProjectResponse.body.id;

      // User 1 should only see their own projects
      const user1ProjectsResponse = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(user1ProjectsResponse.body).toHaveLength(1);
      expect(user1ProjectsResponse.body[0].id).toBe(user1ProjectId);
      expect(user1ProjectsResponse.body[0].name).toBe('User 1 Project');

      // User 2 should only see their own projects
      const user2ProjectsResponse = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(200);

      expect(user2ProjectsResponse.body).toHaveLength(1);
      expect(user2ProjectsResponse.body[0].id).toBe(user2ProjectId);
      expect(user2ProjectsResponse.body[0].name).toBe('User 2 Project');

      // User 1 should not be able to access User 2's project
      await request(app)
        .get(`/api/projects/${user2ProjectId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403);

      // User 2 should not be able to access User 1's project
      await request(app)
        .get(`/api/projects/${user1ProjectId}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(403);

      // User 1 should not be able to update User 2's project
      await request(app)
        .put(`/api/projects/${user2ProjectId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'Hacked Project' })
        .expect(403);

      // User 1 should not be able to delete User 2's project
      await request(app)
        .delete(`/api/projects/${user2ProjectId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403);
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 for non-existent routes', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('message', 'Route not found');
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/register')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400); // Phase 1: malformed JSON is a client error (was 500)

      expect(response.body).toHaveProperty('message', 'Invalid JSON body');
    });

    it('should handle missing authentication', async () => {
      const response = await request(app)
        .get('/api/projects')
        .expect(401);

      expect(response.body).toHaveProperty('message', 'Unauthorized');
    });

    it('should handle invalid authentication token', async () => {
      const response = await request(app)
        .get('/api/projects')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).toHaveProperty('message', 'Unauthorized');
    });
  });

  describe('Data Validation', () => {
    let token;

    beforeEach(async () => {
      const registerResponse = await request(app)
        .post('/api/register')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123'
        });
      
      token = registerResponse.body.token;
    });

    it('should validate project data types', async () => {
      const response = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Project',
          nodes: 'not an array',
          edges: 'not an array'
        })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Nodes and edges must be arrays');
    });

    it('should validate string lengths', async () => {
      const longName = 'a'.repeat(101);
      
      const response = await request(app)
        .post('/api/projects/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: longName })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Project name must be 100 characters or less');
    });

    it('should validate email format', async () => {
      const response = await request(app)
        .post('/api/register')
        .send({
          name: 'Test User',
          email: 'invalid-email',
          password: 'password123'
        })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Please provide a valid email address');
    });
  });
});