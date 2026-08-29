import { describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../app.js';
import { initGraphQL } from '../index.js';
import prisma from '../../db/client.js';
import authService from '../../services/auth.service.js';
import { Roles } from '../../../../shared/types/user.types.js';

// Exercises the *new* half of the unified auth model: a logged-in browser
// session (cookie, no API key) reaching POST /api/v1/graphql. Before this
// migration only Bearer chk_ API keys could reach GraphQL at all.
//
// Key properties under test:
//  - a session actor needs no API-key scope (scopes: 'full')
//  - a non-admin session actor is ownership-scoped exactly like REST
//  - a session ADMIN gets REST's unrestricted bypass
//  - no auth at all is still UNAUTHENTICATED

const app = createApp();

beforeAll(async () => {
  await initGraphQL(app);
});

afterAll(async () => {
  await prisma.document.deleteMany({});
  await prisma.propertyOwnership.deleteMany({});
  await prisma.property.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.$disconnect();
  await new Promise((resolve) => setTimeout(resolve, 100));
});

describe('GraphQL - session actor', () => {
  let landlordCookies: string[];
  let otherCookies: string[];
  let adminCookies: string[];

  async function login(email: string, password: string): Promise<string[]> {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    return [res.headers['set-cookie']] as unknown as string[];
  }

  function gql(cookies: string[] | null, query: string, variables?: object) {
    const req = request(app).post('/api/v1/graphql');
    if (cookies) req.set('Cookie', cookies);
    return req.send({ query, variables });
  }

  beforeEach(async () => {
    await prisma.document.deleteMany({});
    await prisma.propertyOwnership.deleteMany({});
    await prisma.property.deleteMany({});
    await prisma.user.deleteMany({});

    await authService.createUser('sess-ll@example.com', 'Password123', Roles.LANDLORD);
    await authService.createUser('sess-other@example.com', 'Password123', Roles.LANDLORD);
    await authService.createUser('sess-admin@example.com', 'Password123', Roles.ADMIN);

    landlordCookies = await login('sess-ll@example.com', 'Password123');
    otherCookies = await login('sess-other@example.com', 'Password123');
    adminCookies = await login('sess-admin@example.com', 'Password123');
  });

  it('rejects a request with no session and no API key', async () => {
    const res = await gql(null, '{ properties { id } }');
    expect(res.status).toBe(200);
    expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
  });

  it('lets a logged-in session user query without any API-key scope', async () => {
    const res = await gql(landlordCookies, '{ properties { id } }');
    expect(res.body.errors).toBeUndefined();
    expect(Array.isArray(res.body.data.properties)).toBe(true);
  });

  it('scopes a non-admin session user to properties they own', async () => {
    // landlord creates a property via GraphQL (gets 100% ownership)
    const created = await gql(landlordCookies, `
      mutation {
        createProperty(input: {
          name: "Session LL Property"
          street: "1 Session Way"
          city: "Leeds"
          county: "West Yorkshire"
          postcode: "LS1 1AA"
          propertyType: "Flat"
        }) { id }
      }
    `);
    expect(created.body.errors).toBeUndefined();
    const propId = created.body.data.createProperty.id;

    // owner sees it
    const mine = await gql(landlordCookies, '{ properties { id } }');
    expect(mine.body.data.properties.map((p: { id: string }) => p.id)).toContain(propId);

    // a different non-admin session user does not
    const theirs = await gql(otherCookies, '{ properties { id } }');
    expect(theirs.body.data.properties).toHaveLength(0);
    const theirRead = await gql(otherCookies, `{ property(id: "${propId}") { id } }`);
    expect(theirRead.body.data.property).toBeNull();
  });

  it('gives a session ADMIN REST-style unrestricted visibility', async () => {
    const created = await gql(landlordCookies, `
      mutation {
        createProperty(input: {
          name: "Admin Bypass Property"
          street: "2 Session Way"
          city: "Leeds"
          county: "West Yorkshire"
          postcode: "LS2 2BB"
          propertyType: "Flat"
        }) { id }
      }
    `);
    const propId = created.body.data.createProperty.id;

    const adminList = await gql(adminCookies, '{ properties { id } }');
    expect(adminList.body.errors).toBeUndefined();
    expect(adminList.body.data.properties.map((p: { id: string }) => p.id)).toContain(propId);

    const adminRead = await gql(adminCookies, `{ property(id: "${propId}") { id name } }`);
    expect(adminRead.body.data.property.name).toBe('Admin Bypass Property');
  });

  describe('deleteDocument', () => {
    async function makeOwnedProperty(cookies: string[]): Promise<string> {
      const res = await gql(cookies, `
        mutation {
          createProperty(input: {
            name: "Doc Property"
            street: "3 Session Way"
            city: "Leeds"
            county: "West Yorkshire"
            postcode: "LS3 3CC"
            propertyType: "Flat"
          }) { id }
        }
      `);
      return res.body.data.createProperty.id;
    }

    it('deletes a document attached to an entity the session user owns', async () => {
      const propId = await makeOwnedProperty(landlordCookies);
      const doc = await prisma.document.create({
        data: {
          entityType: 'Property',
          entityId: propId,
          fileName: 'note.txt',
          filePath: 'session-actor-test-note.txt',
          fileType: 'text/plain',
          fileSize: 3,
        },
      });

      const res = await gql(landlordCookies, `mutation { deleteDocument(id: "${doc.id}") }`);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.deleteDocument).toBe(true);
      expect(await prisma.document.findUnique({ where: { id: doc.id } })).toBeNull();
    });

    it('returns false (no delete) for a document on an entity the session user does not own', async () => {
      const propId = await makeOwnedProperty(landlordCookies);
      const doc = await prisma.document.create({
        data: {
          entityType: 'Property',
          entityId: propId,
          fileName: 'secret.txt',
          filePath: 'session-actor-test-secret.txt',
          fileType: 'text/plain',
          fileSize: 6,
        },
      });

      const res = await gql(otherCookies, `mutation { deleteDocument(id: "${doc.id}") }`);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.deleteDocument).toBe(false);
      expect(await prisma.document.findUnique({ where: { id: doc.id } })).not.toBeNull();
    });
  });
});
