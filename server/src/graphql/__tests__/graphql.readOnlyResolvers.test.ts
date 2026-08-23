import { describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../app.js';
import { initGraphQL } from '../index.js';
import prisma from '../../db/client.js';
import authService from '../../services/auth.service.js';
import crypto from 'crypto';

const app = createApp();

beforeAll(async () => {
  await initGraphQL(app);
});

afterAll(async () => {
  await prisma.transactionAuditLog.deleteMany({});
  await prisma.syncLog.deleteMany({});
  await prisma.matchingRule.deleteMany({});
  await prisma.bankAccount.deleteMany({});
  await prisma.document.deleteMany({});
  await prisma.settlement.deleteMany({});
  await prisma.apiKey.deleteMany({});
  await prisma.propertyOwnership.deleteMany({});
  await prisma.property.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.$disconnect();
  await new Promise((resolve) => setTimeout(resolve, 100));
});

describe('GraphQL API - read-only & unscoped resolvers', () => {
  let userId: string;
  let otherUserId: string;
  let thirdUserId: string;
  let propertyId: string;

  async function createTestKey(
    ownerUserId: string,
    scopes: string[],
    opts?: { expired?: boolean; revoked?: boolean }
  ): Promise<string> {
    const rawKey = 'chk_' + crypto.randomBytes(32).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const expiresAt = opts?.expired
      ? new Date(Date.now() - 1000)
      : new Date(Date.now() + 86400000 * 365);
    const revokedAt = opts?.revoked ? new Date() : null;

    await prisma.apiKey.create({
      data: {
        userId: ownerUserId,
        name: 'test-key',
        keyHash,
        keyPrefix: rawKey.slice(4, 12),
        scopes: JSON.stringify(scopes),
        expiresAt,
        revokedAt,
      },
    });
    return rawKey;
  }

  function gqlRequest(rawKey: string | null, query: string, variables?: object) {
    const req = request(app).post('/api/v1/graphql');
    if (rawKey) req.set('Authorization', `Bearer ${rawKey}`);
    return req.send({ query, variables });
  }

  beforeEach(async () => {
    await prisma.transactionAuditLog.deleteMany({});
    await prisma.syncLog.deleteMany({});
    await prisma.matchingRule.deleteMany({});
    await prisma.bankAccount.deleteMany({});
    await prisma.document.deleteMany({});
    await prisma.settlement.deleteMany({});
    await prisma.apiKey.deleteMany({});
    await prisma.propertyOwnership.deleteMany({});
    await prisma.property.deleteMany({});
    await prisma.user.deleteMany({});

    const user = await authService.createUser('gqlro-user@example.com', 'Password123', 'ADMIN');
    userId = user.id;
    const other = await authService.createUser('gqlro-other@example.com', 'Password123', 'LANDLORD');
    otherUserId = other.id;
    const third = await authService.createUser('gqlro-third@example.com', 'Password123', 'LANDLORD');
    thirdUserId = third.id;

    const property = await prisma.property.create({
      data: {
        name: 'Read-only Test Property',
        street: '10 Test Street',
        city: 'Bristol',
        county: 'Somerset',
        postcode: 'BS1 1AA',
        propertyType: 'Flat',
        status: 'Available',
      },
    });
    propertyId = property.id;
  });

  describe('Matching Rules', () => {
    it('returns FORBIDDEN for matchingRules query without scope', async () => {
      const rawKey = await createTestKey(userId, ['settlements:read']);
      const res = await gqlRequest(rawKey, '{ matchingRules { id } }');
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('returns FORBIDDEN for createMatchingRule without write scope', async () => {
      const rawKey = await createTestKey(userId, ['matching_rules:read']);
      const res = await gqlRequest(rawKey, `
        mutation {
          createMatchingRule(input: { priority: 1, name: "rule", conditions: "{}" }) { id }
        }
      `);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('performs full CRUD with a minimal input (priority, name, conditions only)', async () => {
      const rawKey = await createTestKey(userId, ['matching_rules:read', 'matching_rules:write']);

      const createRes = await gqlRequest(rawKey, `
        mutation {
          createMatchingRule(input: { priority: 5, name: "Minimal Rule", conditions: "{\\"foo\\":true}" }) {
            id
            name
            priority
            enabled
            bankAccountId
            propertyId
            type
            category
          }
        }
      `);
      expect(createRes.body.errors).toBeUndefined();
      const created = createRes.body.data.createMatchingRule;
      expect(created.name).toBe('Minimal Rule');
      expect(created.priority).toBe(5);
      expect(created.enabled).toBe(true);
      expect(created.bankAccountId).toBeNull();
      const ruleId = created.id;

      // Read by id
      const readRes = await gqlRequest(rawKey, `{ matchingRule(id: "${ruleId}") { id name } }`);
      expect(readRes.body.errors).toBeUndefined();
      expect(readRes.body.data.matchingRule.name).toBe('Minimal Rule');

      // List
      const listRes = await gqlRequest(rawKey, '{ matchingRules { id } }');
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.matchingRules).toHaveLength(1);

      // Update
      const updateRes = await gqlRequest(rawKey, `
        mutation {
          updateMatchingRule(id: "${ruleId}", input: { name: "Renamed Rule", priority: 9 }) {
            id
            name
            priority
          }
        }
      `);
      expect(updateRes.body.errors).toBeUndefined();
      expect(updateRes.body.data.updateMatchingRule.name).toBe('Renamed Rule');
      expect(updateRes.body.data.updateMatchingRule.priority).toBe(9);

      // Delete
      const deleteRes = await gqlRequest(rawKey, `mutation { deleteMatchingRule(id: "${ruleId}") }`);
      expect(deleteRes.body.errors).toBeUndefined();
      expect(deleteRes.body.data.deleteMatchingRule).toBe(true);

      // Confirm gone
      const afterRes = await gqlRequest(rawKey, `{ matchingRule(id: "${ruleId}") { id } }`);
      expect(afterRes.body.errors).toBeUndefined();
      expect(afterRes.body.data.matchingRule).toBeNull();
    });

    it('returns null/false for update/delete of a non-existent rule', async () => {
      const rawKey = await createTestKey(userId, ['matching_rules:write']);

      const updateRes = await gqlRequest(rawKey, `
        mutation {
          updateMatchingRule(id: "does-not-exist", input: { name: "X" }) { id }
        }
      `);
      expect(updateRes.body.errors).toBeUndefined();
      expect(updateRes.body.data.updateMatchingRule).toBeNull();

      const deleteRes = await gqlRequest(rawKey, `mutation { deleteMatchingRule(id: "does-not-exist") }`);
      expect(deleteRes.body.errors).toBeUndefined();
      expect(deleteRes.body.data.deleteMatchingRule).toBe(false);
    });

    it('has no ownership scoping: any key with matching_rules:read sees rules created by another user', async () => {
      const creatorKey = await createTestKey(userId, ['matching_rules:write']);
      const createRes = await gqlRequest(creatorKey, `
        mutation {
          createMatchingRule(input: { priority: 1, name: "Global Rule", conditions: "{}" }) { id }
        }
      `);
      expect(createRes.body.errors).toBeUndefined();

      const otherKey = await createTestKey(otherUserId, ['matching_rules:read']);
      const listRes = await gqlRequest(otherKey, '{ matchingRules { id name } }');
      expect(listRes.body.errors).toBeUndefined();
      const names = (listRes.body.data.matchingRules as Array<{ name: string }>).map((r) => r.name);
      expect(names).toContain('Global Rule');
    });

    it('filters matchingRules by bankAccountId', async () => {
      const bankAccount = await prisma.bankAccount.create({
        data: {
          accountId: 'acct-mr-1',
          accountName: 'Test Account',
          accountType: 'business',
          accessToken: 'token-value',
          syncFromDate: new Date(),
        },
      });

      const rawKey = await createTestKey(userId, ['matching_rules:read', 'matching_rules:write']);
      await gqlRequest(rawKey, `
        mutation {
          createMatchingRule(input: { priority: 1, name: "Scoped Rule", conditions: "{}", bankAccountId: "${bankAccount.id}" }) { id }
        }
      `);
      await gqlRequest(rawKey, `
        mutation {
          createMatchingRule(input: { priority: 2, name: "Unscoped Rule", conditions: "{}" }) { id }
        }
      `);

      const res = await gqlRequest(rawKey, `{ matchingRules(bankAccountId: "${bankAccount.id}") { id name } }`);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.matchingRules).toHaveLength(1);
      expect(res.body.data.matchingRules[0].name).toBe('Scoped Rule');
    });

    it('returns null for matchingRule with an unknown id', async () => {
      const rawKey = await createTestKey(userId, ['matching_rules:read']);
      const res = await gqlRequest(rawKey, '{ matchingRule(id: "nope") { id } }');
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.matchingRule).toBeNull();
    });
  });

  describe('Settlements', () => {
    it('returns FORBIDDEN for settlements query without scope', async () => {
      const rawKey = await createTestKey(userId, ['matching_rules:read']);
      const res = await gqlRequest(rawKey, '{ settlements { id } }');
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('returns FORBIDDEN for createSettlement without write scope', async () => {
      const rawKey = await createTestKey(userId, ['settlements:read']);
      const res = await gqlRequest(rawKey, `
        mutation {
          createSettlement(input: {
            fromUserId: "${userId}"
            toUserId: "${otherUserId}"
            propertyId: "${propertyId}"
            amount: 100
            settlementDate: "2026-01-01T00:00:00.000Z"
          }) { id }
        }
      `);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('overwrites the fromUserId in the input with the caller identity from the API key', async () => {
      const rawKey = await createTestKey(userId, ['settlements:write']);
      const res = await gqlRequest(rawKey, `
        mutation {
          createSettlement(input: {
            fromUserId: "${otherUserId}"
            toUserId: "${otherUserId}"
            propertyId: "${propertyId}"
            amount: 150.5
            settlementDate: "2026-01-01T00:00:00.000Z"
            notes: "initial"
          }) {
            id
            fromUserId
            toUserId
            amount
            notes
          }
        }
      `);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.createSettlement.fromUserId).toBe(userId);
      expect(res.body.data.createSettlement.toUserId).toBe(otherUserId);
      expect(res.body.data.createSettlement.amount).toBe(150.5);
    });

    it('performs a full CRUD cycle and enforces fromUserId/toUserId visibility scoping', async () => {
      const creatorKey = await createTestKey(userId, ['settlements:read', 'settlements:write']);
      const toUserKey = await createTestKey(otherUserId, ['settlements:read', 'settlements:write']);
      const unrelatedKey = await createTestKey(thirdUserId, ['settlements:read', 'settlements:write']);

      const createRes = await gqlRequest(creatorKey, `
        mutation {
          createSettlement(input: {
            fromUserId: "${userId}"
            toUserId: "${otherUserId}"
            propertyId: "${propertyId}"
            amount: 200
            settlementDate: "2026-02-01T00:00:00.000Z"
          }) { id fromUserId toUserId }
        }
      `);
      expect(createRes.body.errors).toBeUndefined();
      const settlementId = createRes.body.data.createSettlement.id;

      // Creator can read it directly
      const readByCreator = await gqlRequest(creatorKey, `{ settlement(id: "${settlementId}") { id amount } }`);
      expect(readByCreator.body.errors).toBeUndefined();
      expect(readByCreator.body.data.settlement.id).toBe(settlementId);

      // toUser can also read it (OR clause)
      const readByToUser = await gqlRequest(toUserKey, `{ settlement(id: "${settlementId}") { id } }`);
      expect(readByToUser.body.errors).toBeUndefined();
      expect(readByToUser.body.data.settlement.id).toBe(settlementId);

      // toUser sees it in the settlements list too
      const listByToUser = await gqlRequest(toUserKey, '{ settlements { id } }');
      expect(listByToUser.body.errors).toBeUndefined();
      expect((listByToUser.body.data.settlements as Array<{ id: string }>).map((s) => s.id)).toContain(
        settlementId
      );

      // Unrelated user cannot read it - returns null
      const readByUnrelated = await gqlRequest(unrelatedKey, `{ settlement(id: "${settlementId}") { id } }`);
      expect(readByUnrelated.body.errors).toBeUndefined();
      expect(readByUnrelated.body.data.settlement).toBeNull();

      // Unrelated user does not see it in the list
      const listByUnrelated = await gqlRequest(unrelatedKey, '{ settlements { id } }');
      expect(listByUnrelated.body.errors).toBeUndefined();
      expect(listByUnrelated.body.data.settlements).toHaveLength(0);

      // Unrelated user cannot update it - returns null
      const updateByUnrelated = await gqlRequest(unrelatedKey, `
        mutation { updateSettlement(id: "${settlementId}", input: { amount: 999 }) { id } }
      `);
      expect(updateByUnrelated.body.errors).toBeUndefined();
      expect(updateByUnrelated.body.data.updateSettlement).toBeNull();

      // Unrelated user cannot delete it - returns false
      const deleteByUnrelated = await gqlRequest(unrelatedKey, `mutation { deleteSettlement(id: "${settlementId}") }`);
      expect(deleteByUnrelated.body.errors).toBeUndefined();
      expect(deleteByUnrelated.body.data.deleteSettlement).toBe(false);

      // Creator can update it
      const updateByCreator = await gqlRequest(creatorKey, `
        mutation { updateSettlement(id: "${settlementId}", input: { amount: 250, notes: "adjusted" }) { id amount notes } }
      `);
      expect(updateByCreator.body.errors).toBeUndefined();
      expect(updateByCreator.body.data.updateSettlement.amount).toBe(250);
      expect(updateByCreator.body.data.updateSettlement.notes).toBe('adjusted');

      // Creator can delete it
      const deleteByCreator = await gqlRequest(creatorKey, `mutation { deleteSettlement(id: "${settlementId}") }`);
      expect(deleteByCreator.body.errors).toBeUndefined();
      expect(deleteByCreator.body.data.deleteSettlement).toBe(true);

      // Now gone entirely
      const afterDelete = await gqlRequest(creatorKey, `{ settlement(id: "${settlementId}") { id } }`);
      expect(afterDelete.body.errors).toBeUndefined();
      expect(afterDelete.body.data.settlement).toBeNull();
    });

    it('filters settlements by propertyId', async () => {
      const otherProperty = await prisma.property.create({
        data: {
          name: 'Second Property',
          street: '20 Other Street',
          city: 'Bristol',
          county: 'Somerset',
          postcode: 'BS2 2BB',
          propertyType: 'House',
          status: 'Available',
        },
      });

      const rawKey = await createTestKey(userId, ['settlements:read', 'settlements:write']);

      await gqlRequest(rawKey, `
        mutation {
          createSettlement(input: {
            fromUserId: "${userId}"
            toUserId: "${otherUserId}"
            propertyId: "${propertyId}"
            amount: 10
            settlementDate: "2026-03-01T00:00:00.000Z"
          }) { id }
        }
      `);
      await gqlRequest(rawKey, `
        mutation {
          createSettlement(input: {
            fromUserId: "${userId}"
            toUserId: "${otherUserId}"
            propertyId: "${otherProperty.id}"
            amount: 20
            settlementDate: "2026-03-01T00:00:00.000Z"
          }) { id }
        }
      `);

      const res = await gqlRequest(rawKey, `{ settlements(propertyId: "${otherProperty.id}") { id amount } }`);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.settlements).toHaveLength(1);
      expect(res.body.data.settlements[0].amount).toBe(20);
    });

    it('returns null for updateSettlement on a non-existent id', async () => {
      const rawKey = await createTestKey(userId, ['settlements:write']);
      const res = await gqlRequest(rawKey, `
        mutation { updateSettlement(id: "does-not-exist", input: { amount: 1 }) { id } }
      `);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.updateSettlement).toBeNull();
    });

    it('returns false for deleteSettlement on a non-existent id', async () => {
      const rawKey = await createTestKey(userId, ['settlements:write']);
      const res = await gqlRequest(rawKey, 'mutation { deleteSettlement(id: "does-not-exist") }');
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.deleteSettlement).toBe(false);
    });
  });

  describe('Documents (read-only)', () => {
    async function seedDocuments() {
      await prisma.document.create({
        data: {
          entityType: 'property',
          entityId: propertyId,
          fileName: 'deed.pdf',
          filePath: '/uploads/deed.pdf',
          fileType: 'application/pdf',
          fileSize: 1024,
        },
      });
      await prisma.document.create({
        data: {
          entityType: 'property',
          entityId: 'some-other-property-id',
          fileName: 'insurance.pdf',
          filePath: '/uploads/insurance.pdf',
          fileType: 'application/pdf',
          fileSize: 2048,
        },
      });
      await prisma.document.create({
        data: {
          entityType: 'tenant',
          entityId: 'tenant-1',
          fileName: 'contract.pdf',
          filePath: '/uploads/contract.pdf',
          fileType: 'application/pdf',
          fileSize: 512,
        },
      });
    }

    it('returns FORBIDDEN without documents:read', async () => {
      const rawKey = await createTestKey(userId, ['settlements:read']);
      const res = await gqlRequest(rawKey, '{ documents { id } }');
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('lists all documents with no filter', async () => {
      await seedDocuments();
      const rawKey = await createTestKey(userId, ['documents:read']);
      const res = await gqlRequest(rawKey, '{ documents { id fileName entityType } }');
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.documents).toHaveLength(3);
    });

    it('filters documents by entityType', async () => {
      await seedDocuments();
      const rawKey = await createTestKey(userId, ['documents:read']);
      const res = await gqlRequest(rawKey, '{ documents(entityType: "tenant") { id fileName } }');
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.documents).toHaveLength(1);
      expect(res.body.data.documents[0].fileName).toBe('contract.pdf');
    });

    it('filters documents by entityType and entityId together', async () => {
      await seedDocuments();
      const rawKey = await createTestKey(userId, ['documents:read']);
      const res = await gqlRequest(
        rawKey,
        `{ documents(entityType: "property", entityId: "${propertyId}") { id fileName } }`
      );
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.documents).toHaveLength(1);
      expect(res.body.data.documents[0].fileName).toBe('deed.pdf');
    });

    it('fetches a single document by id and returns null when not found', async () => {
      const doc = await prisma.document.create({
        data: {
          entityType: 'property',
          entityId: propertyId,
          fileName: 'single.pdf',
          filePath: '/uploads/single.pdf',
          fileType: 'application/pdf',
          fileSize: 99,
        },
      });
      const rawKey = await createTestKey(userId, ['documents:read']);

      const found = await gqlRequest(rawKey, `{ document(id: "${doc.id}") { id fileName } }`);
      expect(found.body.errors).toBeUndefined();
      expect(found.body.data.document.fileName).toBe('single.pdf');

      const missing = await gqlRequest(rawKey, '{ document(id: "does-not-exist") { id } }');
      expect(missing.body.errors).toBeUndefined();
      expect(missing.body.data.document).toBeNull();
    });
  });

  describe('Bank Accounts (read-only)', () => {
    it('returns FORBIDDEN without bank_accounts:read', async () => {
      const rawKey = await createTestKey(userId, ['documents:read']);
      const res = await gqlRequest(rawKey, '{ bankAccounts { id } }');
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('lists bank accounts and fetches one by id, returning null when not found', async () => {
      const account = await prisma.bankAccount.create({
        data: {
          accountId: 'acct-ba-1',
          accountName: 'Main Account',
          accountType: 'business',
          accessToken: 'token-value',
          syncFromDate: new Date('2026-01-01T00:00:00.000Z'),
        },
      });
      const rawKey = await createTestKey(userId, ['bank_accounts:read']);

      const listRes = await gqlRequest(rawKey, '{ bankAccounts { id accountName accountType provider } }');
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.bankAccounts).toHaveLength(1);
      expect(listRes.body.data.bankAccounts[0].accountName).toBe('Main Account');
      expect(listRes.body.data.bankAccounts[0].provider).toBe('monzo');

      const foundRes = await gqlRequest(rawKey, `{ bankAccount(id: "${account.id}") { id accountName } }`);
      expect(foundRes.body.errors).toBeUndefined();
      expect(foundRes.body.data.bankAccount.accountName).toBe('Main Account');

      const missingRes = await gqlRequest(rawKey, '{ bankAccount(id: "does-not-exist") { id } }');
      expect(missingRes.body.errors).toBeUndefined();
      expect(missingRes.body.data.bankAccount).toBeNull();
    });
  });

  describe('Sync Logs (read-only)', () => {
    it('returns FORBIDDEN without sync_logs:read', async () => {
      const rawKey = await createTestKey(userId, ['documents:read']);
      const res = await gqlRequest(rawKey, '{ syncLogs { id } }');
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('lists sync logs, filters by bankAccountId, and fetches one by id', async () => {
      const accountA = await prisma.bankAccount.create({
        data: {
          accountId: 'acct-sl-a',
          accountName: 'Account A',
          accountType: 'business',
          accessToken: 'token-a',
          syncFromDate: new Date(),
        },
      });
      const accountB = await prisma.bankAccount.create({
        data: {
          accountId: 'acct-sl-b',
          accountName: 'Account B',
          accountType: 'personal',
          accessToken: 'token-b',
          syncFromDate: new Date(),
        },
      });

      const logA = await prisma.syncLog.create({
        data: {
          bankAccountId: accountA.id,
          syncType: 'manual',
          status: 'completed',
          transactionsFetched: 5,
        },
      });
      await prisma.syncLog.create({
        data: {
          bankAccountId: accountB.id,
          syncType: 'webhook',
          status: 'failed',
          errorMessage: 'boom',
        },
      });

      const rawKey = await createTestKey(userId, ['sync_logs:read']);

      const listRes = await gqlRequest(rawKey, '{ syncLogs { id status } }');
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.syncLogs).toHaveLength(2);

      const filteredRes = await gqlRequest(rawKey, `{ syncLogs(bankAccountId: "${accountA.id}") { id status } }`);
      expect(filteredRes.body.errors).toBeUndefined();
      expect(filteredRes.body.data.syncLogs).toHaveLength(1);
      expect(filteredRes.body.data.syncLogs[0].status).toBe('completed');

      const foundRes = await gqlRequest(rawKey, `{ syncLog(id: "${logA.id}") { id transactionsFetched } }`);
      expect(foundRes.body.errors).toBeUndefined();
      expect(foundRes.body.data.syncLog.transactionsFetched).toBe(5);

      const missingRes = await gqlRequest(rawKey, '{ syncLog(id: "does-not-exist") { id } }');
      expect(missingRes.body.errors).toBeUndefined();
      expect(missingRes.body.data.syncLog).toBeNull();
    });
  });

  describe('Transaction Audit Logs (read-only)', () => {
    it('returns FORBIDDEN without transaction_audit_logs:read', async () => {
      const rawKey = await createTestKey(userId, ['documents:read']);
      const res = await gqlRequest(rawKey, '{ transactionAuditLogs { id } }');
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('lists all audit log entries and filters by transactionId', async () => {
      await prisma.transactionAuditLog.create({
        data: {
          transactionId: 'txn-1',
          userId,
          field: 'amount',
          oldValue: '100',
          newValue: '150',
        },
      });
      await prisma.transactionAuditLog.create({
        data: {
          transactionId: 'txn-2',
          userId,
          field: 'category',
          oldValue: 'rent',
          newValue: 'maintenance',
        },
      });

      const rawKey = await createTestKey(userId, ['transaction_audit_logs:read']);

      const allRes = await gqlRequest(rawKey, '{ transactionAuditLogs { id transactionId field } }');
      expect(allRes.body.errors).toBeUndefined();
      expect(allRes.body.data.transactionAuditLogs).toHaveLength(2);

      const filteredRes = await gqlRequest(rawKey, '{ transactionAuditLogs(transactionId: "txn-1") { id field oldValue newValue } }');
      expect(filteredRes.body.errors).toBeUndefined();
      expect(filteredRes.body.data.transactionAuditLogs).toHaveLength(1);
      expect(filteredRes.body.data.transactionAuditLogs[0].field).toBe('amount');
      expect(filteredRes.body.data.transactionAuditLogs[0].oldValue).toBe('100');
      expect(filteredRes.body.data.transactionAuditLogs[0].newValue).toBe('150');
    });
  });
});
