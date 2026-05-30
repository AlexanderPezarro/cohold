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
  await prisma.apiKey.deleteMany({});
  await prisma.propertyOwnership.deleteMany({});
  await prisma.property.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.$disconnect();
  await new Promise((resolve) => setTimeout(resolve, 100));
});

describe('GraphQL API', () => {
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
    await prisma.apiKey.deleteMany({});
    await prisma.propertyOwnership.deleteMany({});
    await prisma.property.deleteMany({});
    await prisma.user.deleteMany({});

    const user = await authService.createUser('gqluser@example.com', 'Password123', 'ADMIN');
    userId = user.id;
    const other = await authService.createUser('gqlother@example.com', 'Password123', 'LANDLORD');
    otherUserId = other.id;
  });

  describe('Authentication', () => {
    it('returns UNAUTHENTICATED when no auth header is provided', async () => {
      const res = await gqlRequest(null, '{ properties { id } }');
      expect(res.status).toBe(200);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    });

    it('returns UNAUTHENTICATED for an invalid key', async () => {
      const res = await gqlRequest('chk_invalidkeyvalue', '{ properties { id } }');
      expect(res.status).toBe(401);
    });

    it('returns UNAUTHENTICATED for an expired key', async () => {
      const rawKey = await createTestKey(userId, ['properties:read'], { expired: true });
      const res = await gqlRequest(rawKey, '{ properties { id } }');
      expect(res.status).toBe(401);
    });

    it('returns UNAUTHENTICATED for a revoked key', async () => {
      const rawKey = await createTestKey(userId, ['properties:read'], { revoked: true });
      const res = await gqlRequest(rawKey, '{ properties { id } }');
      expect(res.status).toBe(401);
    });
  });

  describe('Scope enforcement', () => {
    it('returns FORBIDDEN when key lacks the required scope', async () => {
      const rawKey = await createTestKey(userId, ['tenants:read']); // no properties:read
      const res = await gqlRequest(rawKey, '{ properties { id } }');
      expect(res.status).toBe(200);
      expect(res.body.errors).toBeDefined();
      expect(res.body.errors[0].extensions.code).toBe('FORBIDDEN');
    });

    it('returns data when key has the correct scope', async () => {
      const rawKey = await createTestKey(userId, ['properties:read']);
      const res = await gqlRequest(rawKey, '{ properties { id name } }');
      expect(res.status).toBe(200);
      expect(res.body.errors).toBeUndefined();
      expect(Array.isArray(res.body.data.properties)).toBe(true);
    });
  });

  describe('Property CRUD', () => {
    it('performs full CRUD cycle for properties', async () => {
      const rawKey = await createTestKey(userId, ['properties:read', 'properties:write']);

      // Create
      const createRes = await gqlRequest(rawKey, `
        mutation {
          createProperty(input: {
            name: "GraphQL Test Property"
            street: "1 Test Street"
            city: "London"
            county: "Greater London"
            postcode: "SW1A 1AA"
            propertyType: "Flat"
            status: "Available"
          }) {
            id
            name
          }
        }
      `);
      expect(createRes.body.errors).toBeUndefined();
      expect(createRes.body.data.createProperty.name).toBe('GraphQL Test Property');
      const propertyId = createRes.body.data.createProperty.id;

      // Read
      const readRes = await gqlRequest(rawKey, `{ property(id: "${propertyId}") { id name } }`);
      expect(readRes.body.errors).toBeUndefined();
      expect(readRes.body.data.property.name).toBe('GraphQL Test Property');

      // Update
      const updateRes = await gqlRequest(rawKey, `
        mutation {
          updateProperty(id: "${propertyId}", input: { name: "Updated Name" }) {
            id
            name
          }
        }
      `);
      expect(updateRes.body.errors).toBeUndefined();
      expect(updateRes.body.data.updateProperty.name).toBe('Updated Name');

      // Delete
      const deleteRes = await gqlRequest(rawKey, `
        mutation {
          deleteProperty(id: "${propertyId}")
        }
      `);
      expect(deleteRes.body.errors).toBeUndefined();
      expect(deleteRes.body.data.deleteProperty).toBe(true);
    });

    it('does not return properties owned by another user', async () => {
      // Create a property owned by otherUser
      const otherKey = await createTestKey(otherUserId, ['properties:read', 'properties:write']);
      await gqlRequest(otherKey, `
        mutation {
          createProperty(input: {
            name: "Other User Property"
            street: "2 Test Road"
            city: "Manchester"
            county: "Greater Manchester"
            postcode: "M1 1AA"
            propertyType: "House"
            status: "Available"
          }) { id }
        }
      `);

      // Current user should see zero properties
      const rawKey = await createTestKey(userId, ['properties:read']);
      const res = await gqlRequest(rawKey, '{ properties { id name } }');
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.properties).toHaveLength(0);
    });
  });

  describe('Read-only resources', () => {
    it('syncLogs has no mutation in the schema', async () => {
      const rawKey = await createTestKey(userId, ['sync_logs:read']);
      // Attempt an introspection query for syncLogs mutations — none should exist
      const res = await gqlRequest(rawKey, `
        {
          __type(name: "Mutation") {
            fields {
              name
            }
          }
        }
      `);
      expect(res.body.errors).toBeUndefined();
      const mutationFields = (res.body.data.__type.fields as Array<{ name: string }>).map((f) => f.name);
      expect(mutationFields).not.toContain('createSyncLog');
      expect(mutationFields).not.toContain('deleteSyncLog');
    });
  });
});
