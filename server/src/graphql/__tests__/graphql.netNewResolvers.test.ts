import { describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../app.js';
import { initGraphQL } from '../index.js';
import prisma from '../../db/client.js';
import authService from '../../services/auth.service.js';
import { Roles } from '../../../../shared/types/user.types.js';

// Net-new resolvers that had no GraphQL equivalent before the REST+GraphQL
// unification: webhookStatus (was REST GET /api/bank/webhooks/status) and
// apiKeys (was REST /api/api-keys, session-only).

const app = createApp();

beforeAll(async () => {
  await initGraphQL(app);
});

afterAll(async () => {
  await prisma.syncLog.deleteMany({});
  await prisma.bankAccount.deleteMany({});
  await prisma.apiKey.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.$disconnect();
  await new Promise((resolve) => setTimeout(resolve, 100));
});

describe('GraphQL - net-new resolvers', () => {
  let adminId: string;

  async function createTestKey(ownerUserId: string, scopes: string[]): Promise<string> {
    const rawKey = 'chk_' + crypto.randomBytes(32).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    await prisma.apiKey.create({
      data: {
        userId: ownerUserId,
        name: 'test-key',
        keyHash,
        keyPrefix: rawKey.slice(4, 12),
        scopes: JSON.stringify(scopes),
        expiresAt: new Date(Date.now() + 86400000 * 30),
      },
    });
    return rawKey;
  }

  async function login(email: string, password: string): Promise<string[]> {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    return [res.headers['set-cookie']] as unknown as string[];
  }

  function gqlKey(rawKey: string | null, query: string, variables?: object) {
    const req = request(app).post('/api/v1/graphql');
    if (rawKey) req.set('Authorization', `Bearer ${rawKey}`);
    return req.send({ query, variables });
  }

  function gqlSession(cookies: string[] | null, query: string, variables?: object) {
    const req = request(app).post('/api/v1/graphql');
    if (cookies) req.set('Cookie', cookies);
    return req.send({ query, variables });
  }

  let adminCookies: string[];
  let landlordCookies: string[];

  beforeEach(async () => {
    await prisma.syncLog.deleteMany({});
    await prisma.bankAccount.deleteMany({});
    await prisma.apiKey.deleteMany({});
    await prisma.user.deleteMany({});

    const admin = await authService.createUser('nn-admin@example.com', 'Password123', Roles.ADMIN);
    adminId = admin.id;
    await authService.createUser('nn-ll@example.com', 'Password123', Roles.LANDLORD);
    adminCookies = await login('nn-admin@example.com', 'Password123');
    landlordCookies = await login('nn-ll@example.com', 'Password123');
  });

  describe('webhookStatus', () => {
    const QUERY = `{
      webhookStatus {
        lastEventTimestamp
        failedCount24h
        failedCount1h
        recentEvents { id accountName status }
        accountStatuses { accountId accountName lastWebhookStatus webhookId }
      }
    }`;

    it('UNAUTHENTICATED with no actor', async () => {
      const res = await gqlKey(null, QUERY);
      expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    });

    it('FORBIDDEN for an API key without webhook_status:read', async () => {
      const key = await createTestKey(adminId, ['sync_logs:read']);
      const res = await gqlKey(key, QUERY);
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('FORBIDDEN for a non-admin session user (assertRole)', async () => {
      const res = await gqlSession(landlordCookies, QUERY);
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('returns aggregated data for a session ADMIN', async () => {
      const account = await prisma.bankAccount.create({
        data: {
          accountId: 'acct-nn-1',
          accountName: 'Webhook Account',
          accountType: 'business',
          accessToken: 'token',
          syncFromDate: new Date(),
          webhookId: 'wh_123',
        },
      });
      await prisma.syncLog.create({
        data: { bankAccountId: account.id, syncType: 'webhook', status: 'failed', errorMessage: 'boom' },
      });

      const res = await gqlSession(adminCookies, QUERY);
      expect(res.body.errors).toBeUndefined();
      const data = res.body.data.webhookStatus;
      expect(data.failedCount24h).toBe(1);
      expect(data.recentEvents).toHaveLength(1);
      expect(data.recentEvents[0].accountName).toBe('Webhook Account');
      expect(data.accountStatuses).toHaveLength(1);
      expect(data.accountStatuses[0].webhookId).toBe('wh_123');
      expect(data.accountStatuses[0].lastWebhookStatus).toBe('failed');
    });

    it('works for an API key that has webhook_status:read', async () => {
      const key = await createTestKey(adminId, ['webhook_status:read']);
      const res = await gqlKey(key, QUERY);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.webhookStatus.failedCount1h).toBe(0);
    });
  });

  describe('apiKeys', () => {
    it('rejects every operation for an API-key actor (assertSessionOnly)', async () => {
      const key = await createTestKey(adminId, ['api_keys:read', 'api_keys:write']);

      const listRes = await gqlKey(key, '{ apiKeys { id } }');
      expect(listRes.body.errors[0].extensions.code).toBe('FORBIDDEN');

      const createRes = await gqlKey(key, `
        mutation {
          createApiKey(input: { name: "x", scopes: ["properties:read"], expiresAt: "${new Date(Date.now() + 86400000).toISOString()}" }) { id }
        }
      `);
      expect(createRes.body.errors[0].extensions.code).toBe('FORBIDDEN');

      const revokeRes = await gqlKey(key, 'mutation { revokeApiKey(id: "whatever") }');
      expect(revokeRes.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('lets a session user create, list and revoke their own key', async () => {
      const expiresAt = new Date(Date.now() + 86400000 * 10).toISOString();
      const createRes = await gqlSession(landlordCookies, `
        mutation {
          createApiKey(input: { name: "n8n flow", scopes: ["properties:read", "transactions:read"], expiresAt: "${expiresAt}" }) {
            id
            name
            scopes
            keyPrefix
            rawKey
          }
        }
      `);
      expect(createRes.body.errors).toBeUndefined();
      const created = createRes.body.data.createApiKey;
      expect(created.rawKey).toMatch(/^chk_/);
      expect(created.scopes).toEqual(['properties:read', 'transactions:read']);

      const listRes = await gqlSession(landlordCookies, '{ apiKeys { id name scopes revokedAt } }');
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.apiKeys).toHaveLength(1);
      expect(listRes.body.data.apiKeys[0].id).toBe(created.id);

      const revokeRes = await gqlSession(landlordCookies, `mutation { revokeApiKey(id: "${created.id}") }`);
      expect(revokeRes.body.errors).toBeUndefined();
      expect(revokeRes.body.data.revokeApiKey).toBe(true);

      const afterRevoke = await gqlSession(landlordCookies, '{ apiKeys { id revokedAt } }');
      expect(afterRevoke.body.data.apiKeys[0].revokedAt).not.toBeNull();
    });

    it('rejects an invalid create input with BAD_USER_INPUT', async () => {
      const res = await gqlSession(landlordCookies, `
        mutation {
          createApiKey(input: { name: "", scopes: [], expiresAt: "${new Date(Date.now() + 86400000).toISOString()}" }) { id }
        }
      `);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    });

    it('only lists the calling user\'s keys and will not revoke another user\'s key', async () => {
      const otherExpires = new Date(Date.now() + 86400000 * 10).toISOString();
      // admin session creates a key
      const adminCreate = await gqlSession(adminCookies, `
        mutation {
          createApiKey(input: { name: "admin key", scopes: ["users:read"], expiresAt: "${otherExpires}" }) { id }
        }
      `);
      const adminKeyId = adminCreate.body.data.createApiKey.id;

      // landlord cannot see it
      const llList = await gqlSession(landlordCookies, '{ apiKeys { id } }');
      expect(llList.body.data.apiKeys).toHaveLength(0);

      // landlord cannot revoke it - returns false, key stays active
      const llRevoke = await gqlSession(landlordCookies, `mutation { revokeApiKey(id: "${adminKeyId}") }`);
      expect(llRevoke.body.data.revokeApiKey).toBe(false);
      const stillActive = await prisma.apiKey.findUnique({ where: { id: adminKeyId } });
      expect(stillActive?.revokedAt).toBeNull();
    });
  });
});
