import { describe, it, expect } from '@jest/globals';
import {
  ownerPropertyWhere,
  ownerPropertyRelationWhere,
  ownerTenantWhere,
  ownerSettlementWhere,
} from '../scoping.js';
import type { Actor } from '../auth.js';

// Risk 5 of the migration plan: dual-mode scoping is the most error-prone part of
// unifying the two API surfaces, because a mistake is a data-exposure bug rather
// than a broken feature. These tests pin the branch matrix directly.
//
//   actor kind         | admin bypass? | filter
//   -------------------|---------------|--------------------------------
//   session ADMIN       | yes           | {} (sees everything)
//   session non-admin   | no            | ownerships.some.userId = self
//   API-key (any owner) | NEVER         | ownerships.some.userId = self

const sessionAdmin: Actor = { userId: 'u-admin', role: 'ADMIN', scopes: 'full' };
const sessionLandlord: Actor = { userId: 'u-ll', role: 'LANDLORD', scopes: 'full' };
const apiKeyActor: Actor = { userId: 'u-key', role: '', scopes: ['properties:read'] };
// An API key owned by a user who happens to be an ADMIN still gets no bypass:
// the key carries no role, so scoping can't distinguish it and must stay strict.
const apiKeyOwnedByAdmin: Actor = { userId: 'u-admin', role: '', scopes: ['properties:read'] };

describe('graphql dual-mode ownership scoping', () => {
  describe('ownerPropertyWhere', () => {
    it('session ADMIN -> no restriction', () => {
      expect(ownerPropertyWhere(sessionAdmin)).toEqual({});
    });
    it('session non-admin -> filter by own ownership', () => {
      expect(ownerPropertyWhere(sessionLandlord)).toEqual({ ownerships: { some: { userId: 'u-ll' } } });
    });
    it('API-key actor -> filter by key owner, never bypass', () => {
      expect(ownerPropertyWhere(apiKeyActor)).toEqual({ ownerships: { some: { userId: 'u-key' } } });
    });
    it('API-key actor owned by an ADMIN user -> still filtered, no bypass', () => {
      expect(ownerPropertyWhere(apiKeyOwnedByAdmin)).toEqual({ ownerships: { some: { userId: 'u-admin' } } });
    });
  });

  describe('ownerPropertyRelationWhere', () => {
    it('session ADMIN -> no restriction', () => {
      expect(ownerPropertyRelationWhere(sessionAdmin)).toEqual({});
    });
    it('session non-admin -> filter through property relation', () => {
      expect(ownerPropertyRelationWhere(sessionLandlord)).toEqual({
        property: { ownerships: { some: { userId: 'u-ll' } } },
      });
    });
    it('API-key actor -> filter through property relation, no bypass', () => {
      expect(ownerPropertyRelationWhere(apiKeyActor)).toEqual({
        property: { ownerships: { some: { userId: 'u-key' } } },
      });
    });
  });

  describe('ownerTenantWhere', () => {
    it('session ADMIN -> no restriction', () => {
      expect(ownerTenantWhere(sessionAdmin)).toEqual({});
    });
    it('session non-admin -> filter through leases -> property -> ownership', () => {
      expect(ownerTenantWhere(sessionLandlord)).toEqual({
        leases: { some: { property: { ownerships: { some: { userId: 'u-ll' } } } } },
      });
    });
    it('API-key actor -> same lease path, no bypass', () => {
      expect(ownerTenantWhere(apiKeyActor)).toEqual({
        leases: { some: { property: { ownerships: { some: { userId: 'u-key' } } } } },
      });
    });
  });

  describe('ownerSettlementWhere', () => {
    it('session ADMIN -> no restriction', () => {
      expect(ownerSettlementWhere(sessionAdmin)).toEqual({});
    });
    it('session non-admin -> only own from/to rows', () => {
      expect(ownerSettlementWhere(sessionLandlord)).toEqual({
        OR: [{ fromUserId: 'u-ll' }, { toUserId: 'u-ll' }],
      });
    });
    it('API-key actor -> only own from/to rows, no bypass even if owner is ADMIN', () => {
      expect(ownerSettlementWhere(apiKeyOwnedByAdmin)).toEqual({
        OR: [{ fromUserId: 'u-admin' }, { toUserId: 'u-admin' }],
      });
    });
  });
});
