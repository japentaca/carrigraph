// Test environment for the server suite (see vitest.config.js, project "server").
// Databases are in-memory (tests/helpers.js), so nothing on disk is touched.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key';
