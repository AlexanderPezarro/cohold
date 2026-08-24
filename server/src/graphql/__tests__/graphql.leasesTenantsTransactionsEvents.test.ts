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
  await prisma.transaction.deleteMany({});
  await prisma.event.deleteMany({});
  await prisma.lease.deleteMany({});
  await prisma.tenant.deleteMany({});
  await prisma.apiKey.deleteMany({});
  await prisma.propertyOwnership.deleteMany({});
  await prisma.property.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.$disconnect();
  await new Promise((resolve) => setTimeout(resolve, 100));
});

describe('GraphQL Leases/Tenants/Transactions/Events resolvers', () => {
  let userId: string;
  let otherUserId: string;

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
    await prisma.transaction.deleteMany({});
    await prisma.event.deleteMany({});
    await prisma.lease.deleteMany({});
    await prisma.tenant.deleteMany({});
    await prisma.apiKey.deleteMany({});
    await prisma.propertyOwnership.deleteMany({});
    await prisma.property.deleteMany({});
    await prisma.user.deleteMany({});

    const user = await authService.createUser('gqluser2@example.com', 'Password123', 'ADMIN');
    userId = user.id;
    const other = await authService.createUser('gqlother2@example.com', 'Password123', 'LANDLORD');
    otherUserId = other.id;
  });

  async function createProperty(rawKey: string, name = 'Resolver Test Property'): Promise<string> {
    const res = await gqlRequest(
      rawKey,
      `
      mutation {
        createProperty(input: {
          name: "${name}"
          street: "1 Resolver Street"
          city: "Bristol"
          county: "Bristol"
          postcode: "BS1 1AA"
          propertyType: "Flat"
        }) { id }
      }
    `
    );
    expect(res.body.errors).toBeUndefined();
    return res.body.data.createProperty.id;
  }

  async function createTenant(rawKey: string, email = 'tenant1@example.com'): Promise<string> {
    const res = await gqlRequest(
      rawKey,
      `
      mutation {
        createTenant(input: {
          firstName: "John"
          lastName: "Doe"
          email: "${email}"
          phone: "07700900000"
        }) { id }
      }
    `
    );
    expect(res.body.errors).toBeUndefined();
    return res.body.data.createTenant.id;
  }

  // ---------------------------------------------------------------------
  // Leases
  // ---------------------------------------------------------------------
  describe('Leases', () => {
    it('returns FORBIDDEN when key lacks leases:read', async () => {
      const rawKey = await createTestKey(userId, ['properties:read']);
      const res = await gqlRequest(rawKey, '{ leases { id } }');
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('returns FORBIDDEN when key lacks leases:write for createLease', async () => {
      const rawKey = await createTestKey(userId, ['properties:write', 'tenants:write', 'leases:read']);
      const propertyId = await createProperty(rawKey);
      const tenantId = await createTenant(rawKey);
      const res = await gqlRequest(
        rawKey,
        `
        mutation {
          createLease(input: {
            propertyId: "${propertyId}"
            tenantId: "${tenantId}"
            startDate: "2026-01-01T00:00:00.000Z"
            monthlyRent: 1200
            securityDepositAmount: 1200
          }) { id }
        }
      `
      );
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('returns FORBIDDEN when creating a lease for a property the caller does not own', async () => {
      const ownerKey = await createTestKey(userId, ['properties:write', 'tenants:write']);
      const otherPropertyId = await createProperty(ownerKey, 'Owner Only Property');
      const tenantId = await createTenant(ownerKey, 'lease-tenant-forbidden@example.com');

      const attackerKey = await createTestKey(otherUserId, ['leases:write']);
      const res = await gqlRequest(
        attackerKey,
        `
        mutation {
          createLease(input: {
            propertyId: "${otherPropertyId}"
            tenantId: "${tenantId}"
            startDate: "2026-01-01T00:00:00.000Z"
            monthlyRent: 1200
            securityDepositAmount: 1200
          }) { id }
        }
      `
      );
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('performs a full CRUD cycle for leases as the owner, including list filters', async () => {
      const rawKey = await createTestKey(userId, [
        'properties:write',
        'tenants:write',
        'leases:read',
        'leases:write',
      ]);
      const propertyId = await createProperty(rawKey);
      const tenantId = await createTenant(rawKey, 'lease-tenant-crud@example.com');

      const createRes = await gqlRequest(
        rawKey,
        `
        mutation {
          createLease(input: {
            propertyId: "${propertyId}"
            tenantId: "${tenantId}"
            startDate: "2026-01-01T00:00:00.000Z"
            monthlyRent: 1200
            securityDepositAmount: 1200
          }) {
            id
            propertyId
            tenantId
            status
            monthlyRent
          }
        }
      `
      );
      expect(createRes.body.errors).toBeUndefined();
      expect(createRes.body.data.createLease.status).toBe('Active');
      const leaseId = createRes.body.data.createLease.id;

      // Single read
      const readRes = await gqlRequest(rawKey, `{ lease(id: "${leaseId}") { id status } }`);
      expect(readRes.body.errors).toBeUndefined();
      expect(readRes.body.data.lease.id).toBe(leaseId);

      // List with propertyId/tenantId/status filters
      const listRes = await gqlRequest(
        rawKey,
        `{ leases(propertyId: "${propertyId}", tenantId: "${tenantId}", status: "Active") { id } }`
      );
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.leases).toHaveLength(1);
      expect(listRes.body.data.leases[0].id).toBe(leaseId);

      // Update
      const updateRes = await gqlRequest(
        rawKey,
        `
        mutation {
          updateLease(id: "${leaseId}", input: { endDate: "2026-02-01T00:00:00.000Z", monthlyRent: 1300 }) {
            id
            status
            monthlyRent
          }
        }
      `
      );
      expect(updateRes.body.errors).toBeUndefined();
      // status is computed from the lease dates, so setting a past endDate ends the lease
      expect(updateRes.body.data.updateLease.status).toBe('Ended');
      expect(updateRes.body.data.updateLease.monthlyRent).toBe(1300);

      // Delete
      const deleteRes = await gqlRequest(rawKey, `mutation { deleteLease(id: "${leaseId}") }`);
      expect(deleteRes.body.errors).toBeUndefined();
      expect(deleteRes.body.data.deleteLease).toBe(true);

      // Confirm gone
      const afterRes = await gqlRequest(rawKey, `{ lease(id: "${leaseId}") { id } }`);
      expect(afterRes.body.errors).toBeUndefined();
      expect(afterRes.body.data.lease).toBeNull();
    });

    it('hides leases owned by another user and denies update/delete', async () => {
      const ownerKey = await createTestKey(userId, [
        'properties:write',
        'tenants:write',
        'leases:write',
      ]);
      const propertyId = await createProperty(ownerKey, 'Other Owner Lease Property');
      const tenantId = await createTenant(ownerKey, 'lease-tenant-nonowner@example.com');
      const createRes = await gqlRequest(
        ownerKey,
        `
        mutation {
          createLease(input: {
            propertyId: "${propertyId}"
            tenantId: "${tenantId}"
            startDate: "2026-01-01T00:00:00.000Z"
            monthlyRent: 900
            securityDepositAmount: 900
          }) { id }
        }
      `
      );
      const leaseId = createRes.body.data.createLease.id;

      const otherKey = await createTestKey(otherUserId, ['leases:read', 'leases:write']);

      const listRes = await gqlRequest(otherKey, '{ leases { id } }');
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.leases).toHaveLength(0);

      const readRes = await gqlRequest(otherKey, `{ lease(id: "${leaseId}") { id } }`);
      expect(readRes.body.errors).toBeUndefined();
      expect(readRes.body.data.lease).toBeNull();

      const updateRes = await gqlRequest(
        otherKey,
        `mutation { updateLease(id: "${leaseId}", input: { monthlyRent: 1300 }) { id } }`
      );
      expect(updateRes.body.errors).toBeUndefined();
      expect(updateRes.body.data.updateLease).toBeNull();

      const deleteRes = await gqlRequest(otherKey, `mutation { deleteLease(id: "${leaseId}") }`);
      expect(deleteRes.body.errors).toBeUndefined();
      expect(deleteRes.body.data.deleteLease).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Tenants
  // ---------------------------------------------------------------------
  describe('Tenants', () => {
    it('returns FORBIDDEN when key lacks tenants:read', async () => {
      const rawKey = await createTestKey(userId, ['properties:read']);
      const res = await gqlRequest(rawKey, '{ tenants { id } }');
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('returns FORBIDDEN when key lacks tenants:write for createTenant', async () => {
      const rawKey = await createTestKey(userId, ['tenants:read']);
      const res = await gqlRequest(
        rawKey,
        `
        mutation {
          createTenant(input: {
            firstName: "Jane"
            lastName: "Roe"
            email: "jane-roe@example.com"
            phone: "07700900001"
          }) { id }
        }
      `
      );
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('allows createTenant with no ownership restriction', async () => {
      const rawKey = await createTestKey(userId, ['tenants:write']);
      const res = await gqlRequest(
        rawKey,
        `
        mutation {
          createTenant(input: {
            firstName: "Unlinked"
            lastName: "Tenant"
            email: "unlinked-tenant@example.com"
            phone: "07700900002"
            emergencyContactName: "Emergency Contact"
            emergencyContactPhone: "07700900099"
            notes: "no lease yet"
          }) { id firstName email }
        }
      `
      );
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.createTenant.email).toBe('unlinked-tenant@example.com');
    });

    it('hides a tenant with no lease from tenants:read query and denies update/delete even for its creator', async () => {
      const rawKey = await createTestKey(userId, ['tenants:read', 'tenants:write']);
      const tenantId = await createTenant(rawKey, 'no-lease-tenant@example.com');

      const listRes = await gqlRequest(rawKey, '{ tenants { id } }');
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.tenants).toHaveLength(0);

      const readRes = await gqlRequest(rawKey, `{ tenant(id: "${tenantId}") { id } }`);
      expect(readRes.body.errors).toBeUndefined();
      expect(readRes.body.data.tenant).toBeNull();

      const updateRes = await gqlRequest(
        rawKey,
        `mutation { updateTenant(id: "${tenantId}", input: { firstName: "Changed" }) { id } }`
      );
      expect(updateRes.body.errors).toBeUndefined();
      expect(updateRes.body.data.updateTenant).toBeNull();

      const deleteRes = await gqlRequest(rawKey, `mutation { deleteTenant(id: "${tenantId}") }`);
      expect(deleteRes.body.errors).toBeUndefined();
      expect(deleteRes.body.data.deleteTenant).toBe(false);
    });

    it('performs a full CRUD cycle once the tenant is linked via a lease to an owned property', async () => {
      const rawKey = await createTestKey(userId, [
        'properties:write',
        'tenants:read',
        'tenants:write',
        'leases:write',
      ]);
      const propertyId = await createProperty(rawKey, 'Tenant Link Property');
      const tenantId = await createTenant(rawKey, 'linked-tenant@example.com');

      const leaseRes = await gqlRequest(
        rawKey,
        `
        mutation {
          createLease(input: {
            propertyId: "${propertyId}"
            tenantId: "${tenantId}"
            startDate: "2026-01-01T00:00:00.000Z"
            monthlyRent: 1000
            securityDepositAmount: 1000
          }) { id }
        }
      `
      );
      expect(leaseRes.body.errors).toBeUndefined();

      // Now visible via search filter too
      const listRes = await gqlRequest(
        rawKey,
        '{ tenants(status: "Active", search: "linked-tenant") { id email } }'
      );
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.tenants).toHaveLength(1);
      expect(listRes.body.data.tenants[0].id).toBe(tenantId);

      const readRes = await gqlRequest(rawKey, `{ tenant(id: "${tenantId}") { id firstName } }`);
      expect(readRes.body.errors).toBeUndefined();
      expect(readRes.body.data.tenant.id).toBe(tenantId);

      const updateRes = await gqlRequest(
        rawKey,
        `mutation { updateTenant(id: "${tenantId}", input: { firstName: "Updated" }) { id firstName status } }`
      );
      expect(updateRes.body.errors).toBeUndefined();
      expect(updateRes.body.data.updateTenant.firstName).toBe('Updated');
      // status is computed from the tenant's leases; this tenant is linked via a current lease
      expect(updateRes.body.data.updateTenant.status).toBe('Active');

      const deleteRes = await gqlRequest(rawKey, `mutation { deleteTenant(id: "${tenantId}") }`);
      expect(deleteRes.body.errors).toBeUndefined();
      expect(deleteRes.body.data.deleteTenant).toBe(true);
    });

    it('hides a tenant linked to another owner\'s property and denies update/delete', async () => {
      const ownerKey = await createTestKey(userId, [
        'properties:write',
        'tenants:write',
        'leases:write',
      ]);
      const propertyId = await createProperty(ownerKey, 'Other Owner Tenant Property');
      const tenantId = await createTenant(ownerKey, 'other-owner-tenant@example.com');
      await gqlRequest(
        ownerKey,
        `
        mutation {
          createLease(input: {
            propertyId: "${propertyId}"
            tenantId: "${tenantId}"
            startDate: "2026-01-01T00:00:00.000Z"
            monthlyRent: 800
            securityDepositAmount: 800
          }) { id }
        }
      `
      );

      const otherKey = await createTestKey(otherUserId, ['tenants:read', 'tenants:write']);

      const listRes = await gqlRequest(otherKey, '{ tenants { id } }');
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.tenants).toHaveLength(0);

      const readRes = await gqlRequest(otherKey, `{ tenant(id: "${tenantId}") { id } }`);
      expect(readRes.body.errors).toBeUndefined();
      expect(readRes.body.data.tenant).toBeNull();

      const updateRes = await gqlRequest(
        otherKey,
        `mutation { updateTenant(id: "${tenantId}", input: { firstName: "Hacked" }) { id } }`
      );
      expect(updateRes.body.errors).toBeUndefined();
      expect(updateRes.body.data.updateTenant).toBeNull();

      const deleteRes = await gqlRequest(otherKey, `mutation { deleteTenant(id: "${tenantId}") }`);
      expect(deleteRes.body.errors).toBeUndefined();
      expect(deleteRes.body.data.deleteTenant).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------
  describe('Transactions', () => {
    it('returns FORBIDDEN when key lacks transactions:read', async () => {
      const rawKey = await createTestKey(userId, ['properties:read']);
      const res = await gqlRequest(rawKey, '{ transactions { id } }');
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('returns FORBIDDEN when key lacks transactions:write for createTransaction', async () => {
      const rawKey = await createTestKey(userId, ['properties:write', 'transactions:read']);
      const propertyId = await createProperty(rawKey);
      const res = await gqlRequest(
        rawKey,
        `
        mutation {
          createTransaction(input: {
            propertyId: "${propertyId}"
            type: "Income"
            category: "Rent"
            amount: 1200
            transactionDate: "2026-02-01T00:00:00.000Z"
            description: "February rent"
          }) { id }
        }
      `
      );
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('returns FORBIDDEN when creating a transaction for a property the caller does not own', async () => {
      const ownerKey = await createTestKey(userId, ['properties:write']);
      const propertyId = await createProperty(ownerKey, 'Owner Only Txn Property');

      const attackerKey = await createTestKey(otherUserId, ['transactions:write']);
      const res = await gqlRequest(
        attackerKey,
        `
        mutation {
          createTransaction(input: {
            propertyId: "${propertyId}"
            type: "Income"
            category: "Rent"
            amount: 500
            transactionDate: "2026-02-01T00:00:00.000Z"
            description: "Unauthorized"
          }) { id }
        }
      `
      );
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('performs a full CRUD cycle for transactions as the owner, including list filters and splits', async () => {
      const rawKey = await createTestKey(userId, [
        'properties:write',
        'transactions:read',
        'transactions:write',
      ]);
      const propertyId = await createProperty(rawKey, 'Transaction CRUD Property');

      const createRes = await gqlRequest(
        rawKey,
        `
        mutation {
          createTransaction(input: {
            propertyId: "${propertyId}"
            type: "Expense"
            category: "Maintenance"
            amount: 250.50
            transactionDate: "2026-03-01T00:00:00.000Z"
            description: "Boiler repair"
          }) {
            id
            type
            category
            amount
            splits { id userId percentage amount }
          }
        }
      `
      );
      expect(createRes.body.errors).toBeUndefined();
      expect(createRes.body.data.createTransaction.type).toBe('Expense');
      // createTransaction routes through transactionService, which auto-generates
      // TransactionSplit rows from PropertyOwnership. The caller is the sole owner,
      // so the expense produces one split for their full 100% share.
      expect(createRes.body.data.createTransaction.splits).toHaveLength(1);
      expect(createRes.body.data.createTransaction.splits[0]).toMatchObject({
        userId,
        percentage: 100,
        amount: 250.5,
      });
      const transactionId = createRes.body.data.createTransaction.id;

      const readRes = await gqlRequest(
        rawKey,
        `{ transaction(id: "${transactionId}") { id amount splits { id } } }`
      );
      expect(readRes.body.errors).toBeUndefined();
      expect(readRes.body.data.transaction.id).toBe(transactionId);

      const listRes = await gqlRequest(
        rawKey,
        `{ transactions(propertyId: "${propertyId}", type: "Expense", category: "Maintenance") { id } }`
      );
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.transactions).toHaveLength(1);

      const updateRes = await gqlRequest(
        rawKey,
        `
        mutation {
          updateTransaction(id: "${transactionId}", input: { amount: 300, description: "Boiler repair (revised)" }) {
            id
            amount
            description
          }
        }
      `
      );
      expect(updateRes.body.errors).toBeUndefined();
      expect(updateRes.body.data.updateTransaction.amount).toBe(300);
      expect(updateRes.body.data.updateTransaction.description).toBe('Boiler repair (revised)');

      const deleteRes = await gqlRequest(
        rawKey,
        `mutation { deleteTransaction(id: "${transactionId}") }`
      );
      expect(deleteRes.body.errors).toBeUndefined();
      expect(deleteRes.body.data.deleteTransaction).toBe(true);

      const afterRes = await gqlRequest(rawKey, `{ transaction(id: "${transactionId}") { id } }`);
      expect(afterRes.body.errors).toBeUndefined();
      expect(afterRes.body.data.transaction).toBeNull();
    });

    it('hides transactions owned by another user and denies update/delete', async () => {
      const ownerKey = await createTestKey(userId, ['properties:write', 'transactions:write']);
      const propertyId = await createProperty(ownerKey, 'Other Owner Txn Property');
      const createRes = await gqlRequest(
        ownerKey,
        `
        mutation {
          createTransaction(input: {
            propertyId: "${propertyId}"
            type: "Income"
            category: "Rent"
            amount: 1100
            transactionDate: "2026-02-15T00:00:00.000Z"
            description: "March rent"
          }) { id }
        }
      `
      );
      const transactionId = createRes.body.data.createTransaction.id;

      const otherKey = await createTestKey(otherUserId, ['transactions:read', 'transactions:write']);

      const listRes = await gqlRequest(otherKey, '{ transactions { id } }');
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.transactions).toHaveLength(0);

      const readRes = await gqlRequest(otherKey, `{ transaction(id: "${transactionId}") { id } }`);
      expect(readRes.body.errors).toBeUndefined();
      expect(readRes.body.data.transaction).toBeNull();

      const updateRes = await gqlRequest(
        otherKey,
        `mutation { updateTransaction(id: "${transactionId}", input: { amount: 1 }) { id } }`
      );
      expect(updateRes.body.errors).toBeUndefined();
      expect(updateRes.body.data.updateTransaction).toBeNull();

      const deleteRes = await gqlRequest(
        otherKey,
        `mutation { deleteTransaction(id: "${transactionId}") }`
      );
      expect(deleteRes.body.errors).toBeUndefined();
      expect(deleteRes.body.data.deleteTransaction).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------
  describe('Events', () => {
    it('returns FORBIDDEN when key lacks events:read', async () => {
      const rawKey = await createTestKey(userId, ['properties:read']);
      const res = await gqlRequest(rawKey, '{ events { id } }');
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('returns FORBIDDEN when key lacks events:write for createEvent', async () => {
      const rawKey = await createTestKey(userId, ['properties:write', 'events:read']);
      const propertyId = await createProperty(rawKey);
      const res = await gqlRequest(
        rawKey,
        `
        mutation {
          createEvent(input: {
            propertyId: "${propertyId}"
            eventType: "Inspection"
            title: "Annual inspection"
            scheduledDate: "2026-04-01T00:00:00.000Z"
          }) { id }
        }
      `
      );
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('returns FORBIDDEN when creating an event for a property the caller does not own', async () => {
      const ownerKey = await createTestKey(userId, ['properties:write']);
      const propertyId = await createProperty(ownerKey, 'Owner Only Event Property');

      const attackerKey = await createTestKey(otherUserId, ['events:write']);
      const res = await gqlRequest(
        attackerKey,
        `
        mutation {
          createEvent(input: {
            propertyId: "${propertyId}"
            eventType: "Inspection"
            title: "Unauthorized inspection"
            scheduledDate: "2026-04-01T00:00:00.000Z"
          }) { id }
        }
      `
      );
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('performs a full CRUD cycle for events as the owner, including list filters', async () => {
      const rawKey = await createTestKey(userId, [
        'properties:write',
        'events:read',
        'events:write',
      ]);
      const propertyId = await createProperty(rawKey, 'Event CRUD Property');

      const createRes = await gqlRequest(
        rawKey,
        `
        mutation {
          createEvent(input: {
            propertyId: "${propertyId}"
            eventType: "Inspection"
            title: "Move-in inspection"
            description: "Initial walkthrough"
            scheduledDate: "2026-04-01T00:00:00.000Z"
            completed: false
          }) {
            id
            eventType
            title
            completed
          }
        }
      `
      );
      expect(createRes.body.errors).toBeUndefined();
      expect(createRes.body.data.createEvent.eventType).toBe('Inspection');
      expect(createRes.body.data.createEvent.completed).toBe(false);
      const eventId = createRes.body.data.createEvent.id;

      const readRes = await gqlRequest(rawKey, `{ event(id: "${eventId}") { id title } }`);
      expect(readRes.body.errors).toBeUndefined();
      expect(readRes.body.data.event.id).toBe(eventId);

      const listRes = await gqlRequest(
        rawKey,
        `{ events(propertyId: "${propertyId}", eventType: "Inspection", completed: false) { id } }`
      );
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.events).toHaveLength(1);

      const updateRes = await gqlRequest(
        rawKey,
        `
        mutation {
          updateEvent(id: "${eventId}", input: { completed: true, completedDate: "2026-04-02T00:00:00.000Z", title: "Move-in inspection (done)" }) {
            id
            completed
            title
          }
        }
      `
      );
      expect(updateRes.body.errors).toBeUndefined();
      expect(updateRes.body.data.updateEvent.completed).toBe(true);
      expect(updateRes.body.data.updateEvent.title).toBe('Move-in inspection (done)');

      // Confirm the completed filter now excludes it
      const listAfterRes = await gqlRequest(
        rawKey,
        `{ events(propertyId: "${propertyId}", completed: false) { id } }`
      );
      expect(listAfterRes.body.errors).toBeUndefined();
      expect(listAfterRes.body.data.events).toHaveLength(0);

      const deleteRes = await gqlRequest(rawKey, `mutation { deleteEvent(id: "${eventId}") }`);
      expect(deleteRes.body.errors).toBeUndefined();
      expect(deleteRes.body.data.deleteEvent).toBe(true);

      const afterRes = await gqlRequest(rawKey, `{ event(id: "${eventId}") { id } }`);
      expect(afterRes.body.errors).toBeUndefined();
      expect(afterRes.body.data.event).toBeNull();
    });

    it('hides events owned by another user and denies update/delete', async () => {
      const ownerKey = await createTestKey(userId, ['properties:write', 'events:write']);
      const propertyId = await createProperty(ownerKey, 'Other Owner Event Property');
      const createRes = await gqlRequest(
        ownerKey,
        `
        mutation {
          createEvent(input: {
            propertyId: "${propertyId}"
            eventType: "Maintenance"
            title: "Boiler service"
            scheduledDate: "2026-05-01T00:00:00.000Z"
          }) { id }
        }
      `
      );
      const eventId = createRes.body.data.createEvent.id;

      const otherKey = await createTestKey(otherUserId, ['events:read', 'events:write']);

      const listRes = await gqlRequest(otherKey, '{ events { id } }');
      expect(listRes.body.errors).toBeUndefined();
      expect(listRes.body.data.events).toHaveLength(0);

      const readRes = await gqlRequest(otherKey, `{ event(id: "${eventId}") { id } }`);
      expect(readRes.body.errors).toBeUndefined();
      expect(readRes.body.data.event).toBeNull();

      const updateRes = await gqlRequest(
        otherKey,
        `mutation { updateEvent(id: "${eventId}", input: { title: "Hacked" }) { id } }`
      );
      expect(updateRes.body.errors).toBeUndefined();
      expect(updateRes.body.data.updateEvent).toBeNull();

      const deleteRes = await gqlRequest(otherKey, `mutation { deleteEvent(id: "${eventId}") }`);
      expect(deleteRes.body.errors).toBeUndefined();
      expect(deleteRes.body.data.deleteEvent).toBe(false);
    });
  });
});
