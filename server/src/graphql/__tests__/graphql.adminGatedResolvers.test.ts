import { describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../app.js';
import { initGraphQL } from '../index.js';
import prisma from '../../db/client.js';
import authService from '../../services/auth.service.js';
import { Roles } from '../../../../shared/types/user.types.js';

// Regression cover for the privilege-escalation gap on the new session surface:
// the five resolver groups whose REST counterparts are `requireAdmin`-gated
// (users, bankAccounts, matchingRules, syncLogs, transactionAuditLogs) only had
// the `assertScope` -> `assertAccess` rename applied. Because a session actor
// carries `scopes: 'full'`, `assertAccess` passes unconditionally, so a plain
// non-admin session could reach every one of them via POST /api/v1/graphql.
// The fix adds `assertRole(context, 'ADMIN')` alongside `assertAccess`. That
// gate is session-only, so API-key actors are unaffected and stay governed
// purely by their scope list (backwards-compat for automation keys).

const app = createApp();

beforeAll(async () => {
  await initGraphQL(app);
});

afterAll(async () => {
  await prisma.matchingRule.deleteMany({});
  await prisma.syncLog.deleteMany({});
  await prisma.bankAccount.deleteMany({});
  await prisma.apiKey.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.$disconnect();
  await new Promise((resolve) => setTimeout(resolve, 100));
});

describe('GraphQL - admin-gated resolvers (session role enforcement)', () => {
  let adminId: string;
  let adminCookies: string[];
  let landlordCookies: string[];

  async function login(email: string, password: string): Promise<string[]> {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    return [res.headers['set-cookie']] as unknown as string[];
  }

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

  function gqlSession(cookies: string[] | null, query: string, variables?: object) {
    const req = request(app).post('/api/v1/graphql');
    if (cookies) req.set('Cookie', cookies);
    return req.send({ query, variables });
  }

  function gqlKey(rawKey: string | null, query: string, variables?: object) {
    const req = request(app).post('/api/v1/graphql');
    if (rawKey) req.set('Authorization', `Bearer ${rawKey}`);
    return req.send({ query, variables });
  }

  beforeEach(async () => {
    await prisma.matchingRule.deleteMany({});
    await prisma.syncLog.deleteMany({});
    await prisma.bankAccount.deleteMany({});
    await prisma.apiKey.deleteMany({});
    await prisma.user.deleteMany({});

    const admin = await authService.createUser('ag-admin@example.com', 'Password123', Roles.ADMIN);
    adminId = admin.id;
    await authService.createUser('ag-ll@example.com', 'Password123', Roles.LANDLORD);
    adminCookies = await login('ag-admin@example.com', 'Password123');
    landlordCookies = await login('ag-ll@example.com', 'Password123');
  });

  // One representative read query per admin-gated resolver group, plus the
  // scope it maps to for the API-key path.
  const cases: Array<{ name: string; query: string; scope: string; dataKey: string }> = [
    { name: 'users', query: '{ users { id email } }', scope: 'users:read', dataKey: 'users' },
    { name: 'bankAccounts', query: '{ bankAccounts { id accountName } }', scope: 'bank_accounts:read', dataKey: 'bankAccounts' },
    { name: 'matchingRules', query: '{ matchingRules { id } }', scope: 'matching_rules:read', dataKey: 'matchingRules' },
    { name: 'syncLogs', query: '{ syncLogs { id } }', scope: 'sync_logs:read', dataKey: 'syncLogs' },
    {
      name: 'transactionAuditLogs',
      query: '{ transactionAuditLogs { id } }',
      scope: 'transaction_audit_logs:read',
      dataKey: 'transactionAuditLogs',
    },
  ];

  for (const c of cases) {
    describe(c.name, () => {
      it('UNAUTHENTICATED with no actor', async () => {
        const res = await gqlSession(null, c.query);
        expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
      });

      it('FORBIDDEN for a non-admin session user', async () => {
        const res = await gqlSession(landlordCookies, c.query);
        expect(res.body.data?.[c.dataKey] ?? null).toBeNull();
        expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
      });

      it('resolves for a session ADMIN', async () => {
        const res = await gqlSession(adminCookies, c.query);
        expect(res.body.errors).toBeUndefined();
        expect(Array.isArray(res.body.data[c.dataKey])).toBe(true);
      });

      it('still resolves for an API key carrying the scope (no role gate for API-key actors)', async () => {
        const key = await createTestKey(adminId, [c.scope]);
        const res = await gqlKey(key, c.query);
        expect(res.body.errors).toBeUndefined();
        expect(Array.isArray(res.body.data[c.dataKey])).toBe(true);
      });

      it('FORBIDDEN for an API key missing the scope', async () => {
        const key = await createTestKey(adminId, ['properties:read']);
        const res = await gqlKey(key, c.query);
        expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
      });
    });
  }

  describe('matchingRules mutations', () => {
    const CREATE = `mutation {
      createMatchingRule(input: {
        priority: 1
        name: "Rent rule"
        conditions: "{\\"contains\\":\\"RENT\\"}"
        type: "income"
        category: "Rent"
      }) { id }
    }`;

    it('FORBIDDEN for a non-admin session user', async () => {
      const res = await gqlSession(landlordCookies, CREATE);
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
      expect(await prisma.matchingRule.count()).toBe(0);
    });

    it('still works for an API key carrying matching_rules:write', async () => {
      const key = await createTestKey(adminId, ['matching_rules:write']);
      const res = await gqlKey(key, CREATE);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.createMatchingRule.id).toBeTruthy();
    });
  });
});
