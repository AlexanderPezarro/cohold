import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../app.js';
import prisma from '../../db/client.js';
import authService from '../../services/auth.service.js';

const app = createApp();

describe('API Keys Routes', () => {
  const user = { email: 'keyuser@example.com', password: 'Password123' };
  const otherUser = { email: 'other@example.com', password: 'Password123' };

  let userCookies: string[];

  const futureDate = (monthsAhead = 6) => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthsAhead);
    return d.toISOString();
  };

  const validPayload = () => ({
    name: 'My Test Key',
    scopes: ['properties:read'],
    expiresAt: futureDate(),
  });

  beforeEach(async () => {
    await prisma.apiKey.deleteMany({});
    await prisma.user.deleteMany({});

    await authService.createUser(user.email, user.password, 'ADMIN');
    await authService.createUser(otherUser.email, otherUser.password, 'LANDLORD');

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password });
    userCookies = loginRes.headers['set-cookie'] as unknown as string[];
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe('GET /api/api-keys', () => {
    it('returns 401 when not authenticated', async () => {
      const res = await request(app).get('/api/api-keys');
      expect(res.status).toBe(401);
    });

    it('returns empty array when user has no keys', async () => {
      const res = await request(app).get('/api/api-keys').set('Cookie', userCookies);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.keys).toHaveLength(0);
    });

    it('returns only keys belonging to the current user', async () => {
      // Create a key for the current user
      await request(app)
        .post('/api/api-keys')
        .set('Cookie', userCookies)
        .send(validPayload());

      // Login as other user and create a key for them
      const otherLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: otherUser.email, password: otherUser.password });
      const otherCookies = otherLogin.headers['set-cookie'];

      await request(app)
        .post('/api/api-keys')
        .set('Cookie', otherCookies)
        .send({ ...validPayload(), name: 'Other Key' });

      // Verify current user sees only their own key
      const res = await request(app).get('/api/api-keys').set('Cookie', userCookies);
      expect(res.status).toBe(200);
      expect(res.body.keys).toHaveLength(1);
      expect(res.body.keys[0].name).toBe('My Test Key');
      expect(res.body.keys[0]).not.toHaveProperty('keyHash');
    });
  });

  describe('POST /api/api-keys', () => {
    it('returns 401 when not authenticated', async () => {
      const res = await request(app).post('/api/api-keys').send(validPayload());
      expect(res.status).toBe(401);
    });

    it('creates a key and returns rawKey starting with chk_', async () => {
      const res = await request(app)
        .post('/api/api-keys')
        .set('Cookie', userCookies)
        .send(validPayload());

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.key.rawKey).toMatch(/^chk_/);
      expect(res.body.key).not.toHaveProperty('keyHash');
      expect(res.body.key.name).toBe('My Test Key');
      expect(Array.isArray(res.body.key.scopes)).toBe(true);
    });

    it('allows duplicate key names for the same user', async () => {
      await request(app)
        .post('/api/api-keys')
        .set('Cookie', userCookies)
        .send(validPayload());

      const res = await request(app)
        .post('/api/api-keys')
        .set('Cookie', userCookies)
        .send(validPayload());

      expect(res.status).toBe(201);
    });

    it('returns 400 when name is missing', async () => {
      const { name: _name, ...payload } = validPayload();
      const res = await request(app)
        .post('/api/api-keys')
        .set('Cookie', userCookies)
        .send(payload);
      expect(res.status).toBe(400);
    });

    it('returns 400 when scopes is empty', async () => {
      const res = await request(app)
        .post('/api/api-keys')
        .set('Cookie', userCookies)
        .send({ ...validPayload(), scopes: [] });
      expect(res.status).toBe(400);
    });

    it('returns 400 when expiresAt is in the past', async () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      const res = await request(app)
        .post('/api/api-keys')
        .set('Cookie', userCookies)
        .send({ ...validPayload(), expiresAt: past });
      expect(res.status).toBe(400);
    });

    it('returns 400 when expiresAt is more than 1 year in the future', async () => {
      const tooFar = futureDate(13); // 13 months ahead
      const res = await request(app)
        .post('/api/api-keys')
        .set('Cookie', userCookies)
        .send({ ...validPayload(), expiresAt: tooFar });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/api-keys/:id', () => {
    it('returns 401 when not authenticated', async () => {
      const res = await request(app).delete('/api/api-keys/some-id');
      expect(res.status).toBe(401);
    });

    it('revokes own key and sets revokedAt', async () => {
      const create = await request(app)
        .post('/api/api-keys')
        .set('Cookie', userCookies)
        .send(validPayload());
      const keyId = create.body.key.id;

      const res = await request(app)
        .delete(`/api/api-keys/${keyId}`)
        .set('Cookie', userCookies);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbKey = await prisma.apiKey.findUnique({ where: { id: keyId } });
      expect(dbKey?.revokedAt).not.toBeNull();
    });

    it("returns 404 when trying to revoke another user's key", async () => {
      const otherLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: otherUser.email, password: otherUser.password });
      const otherCookies = otherLogin.headers['set-cookie'];

      const create = await request(app)
        .post('/api/api-keys')
        .set('Cookie', otherCookies)
        .send(validPayload());
      const otherKeyId = create.body.key.id;

      const res = await request(app)
        .delete(`/api/api-keys/${otherKeyId}`)
        .set('Cookie', userCookies);

      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent key', async () => {
      const res = await request(app)
        .delete('/api/api-keys/00000000-0000-0000-0000-000000000000')
        .set('Cookie', userCookies);
      expect(res.status).toBe(404);
    });
  });
});
