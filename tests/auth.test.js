import request from 'supertest';
import { dbHelpers } from '../server/database.js';
import {
  createTestDatabase,
  createTestApp,
  createTestUser,
  generateJWT,
  cleanDatabase,
  expectValidUser,
  expectValidJWT
} from './helpers.js';

describe('Authentication API', () => {
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

  describe('POST /api/register', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/register')
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('message', 'User registered successfully');
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      
      expectValidUser(response.body.user);
      expectValidJWT(response.body.token);
      expect(response.body.user.email).toBe(userData.email.toLowerCase());
      expect(response.body.user.name).toBe(userData.name);
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/register')
        .send({ name: 'John' })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Name, email, and password are required');
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/api/register')
        .send({
          name: 'John Doe',
          email: 'invalid-email',
          password: 'password123'
        })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Please provide a valid email address');
    });

    it('should return 400 for short password', async () => {
      const response = await request(app)
        .post('/api/register')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          password: '123'
        })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Password must be at least 8 characters long');
    });

    it('should return 409 for duplicate email', async () => {
      const userData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123'
      };

      // Register first user
      await request(app)
        .post('/api/register')
        .send(userData)
        .expect(201);

      // Try to register with same email
      const response = await request(app)
        .post('/api/register')
        .send(userData)
        .expect(409);

      expect(response.body).toHaveProperty('message', 'User with this email already exists');
    });
  });

  describe('POST /api/login', () => {
    let testUser;

    beforeEach(async () => {
      testUser = await createTestUser(db, {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123'
      });
    });

    it('should login successfully with valid credentials', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          email: 'test@example.com',
          password: 'password123'
        })
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Login successful');
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      
      expectValidUser(response.body.user);
      expectValidJWT(response.body.token);
      expect(response.body.user.id).toBe(testUser.id);
    });

    it('should return 400 for missing credentials', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({ email: 'test@example.com' })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Email and password are required');
    });

    it('should return 401 for invalid email', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123'
        })
        .expect(401);

      expect(response.body).toHaveProperty('message', 'Invalid email or password');
    });

    it('should return 401 for invalid password', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword'
        })
        .expect(401);

      expect(response.body).toHaveProperty('message', 'Invalid email or password');
    });
  });

  describe('GET /api/logout', () => {
    it('should logout successfully', async () => {
      const response = await request(app)
        .get('/api/logout')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Logout successful');
    });
  });

  describe('GET /api/me', () => {
    let testUser;
    let token;

    beforeEach(async () => {
      testUser = await createTestUser(db);
      token = generateJWT(testUser.id, testUser.email);
    });

    it('should return current user with valid token', async () => {
      const response = await request(app)
        .get('/api/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expectValidUser(response.body.user);
      expect(response.body.user.id).toBe(testUser.id);
    });

    it('should return 401 without token', async () => {
      const response = await request(app)
        .get('/api/me')
        .expect(401);

      expect(response.body).toHaveProperty('message', 'Unauthorized');
    });

    it('should return 401 with invalid token', async () => {
      const response = await request(app)
        .get('/api/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).toHaveProperty('message', 'Unauthorized');
    });
  });

  describe('POST /api/verify-token', () => {
    let testUser;
    let token;

    beforeEach(async () => {
      testUser = await createTestUser(db);
      token = generateJWT(testUser.id, testUser.email);
    });

    it('should verify valid token', async () => {
      const response = await request(app)
        .post('/api/verify-token')
        .send({ token })
        .expect(200);

      expect(response.body).toHaveProperty('valid', true);
      expect(response.body).toHaveProperty('user');
      expectValidUser(response.body.user);
    });

    it('should return 400 for missing token', async () => {
      const response = await request(app)
        .post('/api/verify-token')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Token is required');
    });

    it('should return 401 for invalid token', async () => {
      const response = await request(app)
        .post('/api/verify-token')
        .send({ token: 'invalid-token' })
        .expect(401);

      expect(response.body).toHaveProperty('valid', false);
      expect(response.body).toHaveProperty('message', 'Invalid or expired token');
    });
  });

  describe('PUT /api/change-password', () => {
    let testUser;
    let token;

    beforeEach(async () => {
      testUser = await createTestUser(db, {
        password: 'oldpassword123'
      });
      token = generateJWT(testUser.id, testUser.email);
    });

    it('should change password successfully', async () => {
      const response = await request(app)
        .put('/api/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'oldpassword123',
          newPassword: 'newpassword123'
        })
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Password changed successfully');

      // Verify new password works for login
      const loginResponse = await request(app)
        .post('/api/login')
        .send({
          email: testUser.email,
          password: 'newpassword123'
        })
        .expect(200);

      expect(loginResponse.body).toHaveProperty('token');
    });

    it('should return 400 for missing fields', async () => {
      const response = await request(app)
        .put('/api/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'oldpassword123' })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Current password and new password are required');
    });

    it('should return 401 for incorrect current password', async () => {
      const response = await request(app)
        .put('/api/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'wrongpassword',
          newPassword: 'newpassword123'
        })
        .expect(401);

      expect(response.body).toHaveProperty('message', 'Current password is incorrect');
    });

    it('should return 400 for short new password', async () => {
      const response = await request(app)
        .put('/api/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'oldpassword123',
          newPassword: '123'
        })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'New password must be at least 8 characters long');
    });
  });

  describe('PUT /api/profile', () => {
    let testUser;
    let token;

    beforeEach(async () => {
      testUser = await createTestUser(db);
      token = generateJWT(testUser.id, testUser.email);
    });

    it('should update profile successfully', async () => {
      const updateData = {
        name: 'Updated Name',
        email: 'updated@example.com'
      };

      const response = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${token}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Profile updated successfully');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.name).toBe(updateData.name);
      expect(response.body.user.email).toBe(updateData.email);
    });

    it('should return 400 for missing fields', async () => {
      const response = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Name' })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Name and email are required');
    });

    it('should return 400 for invalid email', async () => {
      const response = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Updated Name',
          email: 'invalid-email'
        })
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Please provide a valid email address');
    });

    it('should return 409 for email already taken', async () => {
      // Create another user
      await createTestUser(db, {
        email: 'taken@example.com'
      });

      const response = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Updated Name',
          email: 'taken@example.com'
        })
        .expect(409);

      expect(response.body).toHaveProperty('message', 'Email is already taken by another user');
    });
  });

  describe('DELETE /api/account', () => {
    let testUser;
    let token;

    beforeEach(async () => {
      testUser = await createTestUser(db, {
        password: 'password123'
      });
      token = generateJWT(testUser.id, testUser.email);
    });

    it('should delete account successfully', async () => {
      const response = await request(app)
        .delete('/api/account')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'password123' })
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Account deleted successfully');

      // Verify user is deleted
      const user = await db.get('SELECT * FROM users WHERE id = ?', testUser.id);
      expect(user).toBeUndefined();
    });

    it('should return 400 for missing password', async () => {
      const response = await request(app)
        .delete('/api/account')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Password is required to delete account');
    });

    it('should return 401 for incorrect password', async () => {
      const response = await request(app)
        .delete('/api/account')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'wrongpassword' })
        .expect(401);

      expect(response.body).toHaveProperty('message', 'Password is incorrect');
    });
  });
});