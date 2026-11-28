import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../app.js';
import prisma from '../../db/client.js';
import authService from '../../services/auth.service.js';
import { Roles } from '../../../../shared/types/user.types.js';
import { decryptToken } from '../../services/encryption.js';

const app = createApp();

const ENV_KEYS = [
  'MONZO_CLIENT_ID',
  'MONZO_CLIENT_SECRET',
  'MONZO_REDIRECT_URI',
  'WEBHOOK_BASE_URL',
  'MONZO_WEBHOOK_SECRET',
  'CLIENT_URL',
] as const;

describe('Monzo settings routes', () => {
  const user = { email: 'settings-user@example.com', password: 'testPassword123' };
  const admin = { email: 'settings-admin@example.com', password: 'adminPassword123' };
  let userCookie: string;
  let adminCookie: string;
  const saved: Record<string, string | undefined> = {};

  const payload = {
    clientId: 'oauth2client_test123',
    clientSecret: 'mock-super-secret-value',
    redirectUri: 'https://cohold.example.test/api/bank/monzo/callback',
    webhookBaseUrl: 'https://cohold.example.test',
  };

  beforeAll(async () => {
    await prisma.bankAccount.deleteMany({});
    await prisma.user.deleteMany({});
    await authService.createUser(user.email, user.password);
    userCookie = (await request(app).post('/api/auth/login').send(user)).headers['set-cookie'][0];
    await authService.createUser(admin.email, admin.password, Roles.ADMIN);
    adminCookie = (await request(app).post('/api/auth/login').send(admin)).headers['set-cookie'][0];
  });

  afterAll(async () => {
    await prisma.monzoSettings.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    await prisma.monzoSettings.deleteMany({});
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe('authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      expect((await request(app).get('/api/bank/monzo/settings')).status).toBe(401);
      expect((await request(app).put('/api/bank/monzo/settings').send(payload)).status).toBe(401);
    });

    it('returns 403 for a non-admin user', async () => {
      const get = await request(app).get('/api/bank/monzo/settings').set('Cookie', userCookie);
      const put = await request(app)
        .put('/api/bank/monzo/settings')
        .set('Cookie', userCookie)
        .send(payload);
      expect(get.status).toBe(403);
      expect(put.status).toBe(403);
    });
  });

  describe('GET /settings', () => {
    it('reports unconfigured with suggested URLs built from CLIENT_URL', async () => {
      process.env.CLIENT_URL = 'https://cohold.example.test';
      const res = await request(app).get('/api/bank/monzo/settings').set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        configured: false,
        hasClientSecret: false,
        source: 'none',
        clientId: '',
        suggested: {
          redirectUri: 'https://cohold.example.test/api/bank/monzo/callback',
          webhookBaseUrl: 'https://cohold.example.test',
        },
      });
    });

    it('reflects env fallback values', async () => {
      process.env.MONZO_CLIENT_ID = 'oauth2client_env';
      process.env.MONZO_CLIENT_SECRET = 'mock-env-secret';
      process.env.MONZO_REDIRECT_URI = 'http://localhost:3000/api/bank/monzo/callback';
      const res = await request(app).get('/api/bank/monzo/settings').set('Cookie', adminCookie);
      expect(res.body).toMatchObject({
        configured: true,
        source: 'env',
        clientId: 'oauth2client_env',
        hasClientSecret: true,
      });
      expect(JSON.stringify(res.body)).not.toContain('mock-env-secret');
    });
  });

  describe('PUT /settings', () => {
    it('rejects a first save without a secret', async () => {
      const res = await request(app)
        .put('/api/bank/monzo/settings')
        .set('Cookie', adminCookie)
        .send({ ...payload, clientSecret: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('client_secret_required');
      expect(await prisma.monzoSettings.count()).toBe(0);
    });

    it('creates the row with an encrypted secret and generated webhook secret', async () => {
      const res = await request(app)
        .put('/api/bank/monzo/settings')
        .set('Cookie', adminCookie)
        .send(payload);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        configured: true,
        hasClientSecret: true,
        source: 'db',
        clientId: payload.clientId,
      });

      const row = await prisma.monzoSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
      expect(row.clientSecretEncrypted).not.toBe(payload.clientSecret);
      expect(decryptToken(row.clientSecretEncrypted)).toBe(payload.clientSecret);
      expect(row.webhookSecret).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('never returns the secret, its ciphertext or the webhook secret', async () => {
      const put = await request(app)
        .put('/api/bank/monzo/settings')
        .set('Cookie', adminCookie)
        .send(payload);
      const get = await request(app).get('/api/bank/monzo/settings').set('Cookie', adminCookie);
      const row = await prisma.monzoSettings.findUniqueOrThrow({ where: { id: 'singleton' } });

      for (const body of [put.body, get.body]) {
        const text = JSON.stringify(body);
        expect(text).not.toContain(payload.clientSecret);
        expect(text).not.toContain(row.clientSecretEncrypted);
        expect(text).not.toContain(row.webhookSecret);
      }
    });

    it('keeps the stored secret on a blank secret and never changes the webhook secret', async () => {
      await request(app).put('/api/bank/monzo/settings').set('Cookie', adminCookie).send(payload);
      const before = await prisma.monzoSettings.findUniqueOrThrow({ where: { id: 'singleton' } });

      const res = await request(app)
        .put('/api/bank/monzo/settings')
        .set('Cookie', adminCookie)
        .send({ ...payload, clientSecret: '', webhookBaseUrl: 'https://other.example.test' });
      expect(res.status).toBe(200);

      const after = await prisma.monzoSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
      expect(after.clientSecretEncrypted).toBe(before.clientSecretEncrypted);
      expect(after.webhookSecret).toBe(before.webhookSecret);
      expect(after.webhookBaseUrl).toBe('https://other.example.test');
    });

    it('validates input', async () => {
      const put = (body: object) =>
        request(app).put('/api/bank/monzo/settings').set('Cookie', adminCookie).send(body);

      expect((await put({ ...payload, clientId: 'abc' })).status).toBe(400);
      expect((await put({ ...payload, redirectUri: 'http://example.com/cb' })).status).toBe(400);
      expect(
        (
          await put({
            ...payload,
            redirectUri: 'http://localhost:3000/api/bank/monzo/callback',
            webhookBaseUrl: 'http://localhost:3000',
          })
        ).status
      ).toBe(200);
    });

    it('reports hasBankAccounts', async () => {
      await prisma.bankAccount.create({
        data: {
          accountId: 'acc_settings_test',
          accountName: 'Test',
          accountType: 'uk_retail',
          provider: 'monzo',
          accessToken: 'x',
          syncFromDate: new Date('2024-01-01'),
        },
      });
      const res = await request(app).get('/api/bank/monzo/settings').set('Cookie', adminCookie);
      expect(res.body.hasBankAccounts).toBe(true);
      await prisma.bankAccount.deleteMany({});
    });
  });
});
