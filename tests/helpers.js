import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { initializeDatabase } from '../server/database.js';
import { createApp } from '../server/app.js';

// Each test file gets its own in-memory database with the real schema and
// migrations, so tests never touch server/data/carrigraph.db.
export const createTestDatabase = async () => {
  return initializeDatabase(':memory:', { silent: true });
};

// Full app (same middleware as production) wired to a test database.
export const createTestApp = (db, options = {}) => {
  return createApp({
    db,
    jwtSecret: process.env.JWT_SECRET,
    rateLimit: false,
    serveStatic: false,
    ...options
  });
};

// Test data generators
export const createTestUser = async (db, userData = {}) => {
  const defaultUser = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123'
  };
  
  const user = { ...defaultUser, ...userData };
  const hashedPassword = await bcrypt.hash(user.password, 4);
  
  const result = await db.run(
    'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
    user.name, user.email, hashedPassword
  );
  
  return {
    id: result.lastID,
    name: user.name,
    email: user.email,
    password: hashedPassword
  };
};

export const createTestProject = async (db, userId, projectData = {}) => {
  const defaultProject = {
    name: 'Test Project',
    description: 'A test project',
    nodes: [
      { id: '1', type: 'input', position: { x: 0, y: 0 }, data: { label: 'Input' } },
      { id: '2', type: 'output', position: { x: 200, y: 0 }, data: { label: 'Output' } }
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' }
    ],
    metadata: { version: '1.0', created_by: userId }
  };
  
  const project = { ...defaultProject, ...projectData };
  
  const result = await db.run(
    'INSERT INTO projects (user_id, name, description, nodes, edges, metadata) VALUES (?, ?, ?, ?, ?, ?)',
    userId,
    project.name,
    project.description,
    JSON.stringify(project.nodes),
    JSON.stringify(project.edges),
    JSON.stringify(project.metadata)
  );
  
  return {
    id: result.lastID,
    user_id: userId,
    ...project
  };
};

export const generateJWT = (userId, email) => {
  return jwt.sign(
    { id: userId, email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

export const cleanDatabase = async (db) => {
  await db.exec('DELETE FROM project_versions');
  await db.exec('DELETE FROM projects');
  await db.exec('DELETE FROM users');
};

// Common test assertions
export const expectValidUser = (user) => {
  expect(user).toHaveProperty('id');
  expect(user).toHaveProperty('name');
  expect(user).toHaveProperty('email');
  expect(user).toHaveProperty('created_at');
  expect(user).not.toHaveProperty('password'); // Should not include password
};

export const expectValidProject = (project) => {
  expect(project).toHaveProperty('id');
  expect(project).toHaveProperty('user_id');
  expect(project).toHaveProperty('name');
  expect(project).toHaveProperty('nodes');
  expect(project).toHaveProperty('edges');
  expect(project).toHaveProperty('metadata');
  expect(project).toHaveProperty('created_at');
  expect(project).toHaveProperty('updated_at');
  expect(Array.isArray(project.nodes)).toBe(true);
  expect(Array.isArray(project.edges)).toBe(true);
  expect(typeof project.metadata).toBe('object');
};

// List endpoint returns summaries: no nodes/edges, with counts.
export const expectValidProjectSummary = (project) => {
  expect(project).toHaveProperty('id');
  expect(project).toHaveProperty('user_id');
  expect(project).toHaveProperty('name');
  expect(project).toHaveProperty('created_at');
  expect(project).toHaveProperty('updated_at');
  expect(typeof project.node_count).toBe('number');
  expect(typeof project.edge_count).toBe('number');
  expect(project).not.toHaveProperty('nodes');
  expect(project).not.toHaveProperty('edges');
};

export const expectValidJWT = (token) => {
  expect(typeof token).toBe('string');
  expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
  
  // Verify token can be decoded
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  expect(decoded).toHaveProperty('id');
  expect(decoded).toHaveProperty('email');
  expect(decoded).toHaveProperty('exp');
};