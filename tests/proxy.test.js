// Behind a reverse proxy (deploy/): TRUST_PROXY makes the per-IP limits use the visitor's address.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { parseTrustProxy } from '../server/app.js';
import { createTestDatabase, createTestApp } from './helpers.js';

describe('trust proxy', () => {
  let db;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  const login = (app, forwardedFor) => request(app)
    .post('/api/login')
    .set('X-Forwarded-For', forwardedFor)
    .send({});

  it('parses TRUST_PROXY', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined();
    expect(parseTrustProxy('  ')).toBeUndefined();
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' loopback ')).toBe('loopback');
  });

  it('is off by default: X-Forwarded-For is ignored, every visitor shares the proxy address', async () => {
    const app = createTestApp(db, { rateLimit: { windowMs: 60_000, max: 1 } });
    expect(app.get('trust proxy')).toBe(false);
    await login(app, '203.0.113.1').expect(400);
    await login(app, '203.0.113.2').expect(429);
  });

  it('with a trusted local proxy, each visitor has its own limit', async () => {
    const app = createTestApp(db, { rateLimit: { windowMs: 60_000, max: 1 }, trustProxy: 'loopback' });
    await login(app, '203.0.113.1').expect(400);
    await login(app, '203.0.113.2').expect(400);
    await login(app, '203.0.113.1').expect(429);
  });
});
