// server/src/graphql/scoping.ts
//
// Dual-mode ownership scoping for GraphQL resolvers (migration plan Risk 5 - the
// single most error-prone part of the REST+GraphQL unification, since a mistake
// here is a data-exposure bug).
//
// Two caller kinds hit the same resolvers with different rules:
//
//  - **Session actor** (`actor.scopes === 'full'`): gets exactly REST's
//    behaviour, delegating to `server/src/services/scoping.ts` so the two
//    surfaces can never drift again. In particular an ADMIN session user gets
//    REST's unrestricted bypass.
//  - **API-key actor**: NEVER bypasses. Always filtered by the key's owning
//    `userId`, exactly as every pre-migration resolver did with its hardcoded
//    `{ ownerships: { some: { userId: context.apiKey!.userId } } }`. The hard
//    backwards-compatibility constraint forbids changing API-key semantics, so
//    there is deliberately no admin-bypass branch for them.
//
// `ownerScopingIdentity` returns the userId a resolver should treat as "self"
// for side-effects that stamp an owner (e.g. createProperty's 100%-ownership
// row, createSettlement's fromUserId).

import type { Actor } from './auth.js';
import {
  propertyScope,
  propertyRelationScope,
  tenantScope,
  type ScopeUser,
} from '../services/scoping.js';

function asScopeUser(actor: Actor): ScopeUser {
  return { id: actor.userId, role: actor.role };
}

/** Prisma `where` fragment for a direct Property query/mutation. */
export function ownerPropertyWhere(actor: Actor): Record<string, unknown> {
  if (actor.scopes === 'full') return propertyScope(asScopeUser(actor));
  return { ownerships: { some: { userId: actor.userId } } };
}

/** Prisma `where` fragment for entities that reach Property via a `property` relation. */
export function ownerPropertyRelationWhere(actor: Actor): Record<string, unknown> {
  if (actor.scopes === 'full') return propertyRelationScope(asScopeUser(actor));
  return { property: { ownerships: { some: { userId: actor.userId } } } };
}

/** Prisma `where` fragment for Tenant, which reaches Property only via its leases. */
export function ownerTenantWhere(actor: Actor): Record<string, unknown> {
  if (actor.scopes === 'full') return tenantScope(asScopeUser(actor));
  return { leases: { some: { property: { ownerships: { some: { userId: actor.userId } } } } } };
}

/**
 * Prisma `where` fragment for Settlement visibility (a user sees settlements
 * they are the payer or payee of). REST's settlement routes give ADMIN the same
 * property-ownership bypass everywhere else has; a session ADMIN therefore sees
 * all settlements, while non-admin sessions and every API-key actor are limited
 * to their own from/to rows (unchanged from the pre-migration resolver).
 */
export function ownerSettlementWhere(actor: Actor): Record<string, unknown> {
  if (actor.scopes === 'full' && actor.role === 'ADMIN') return {};
  return { OR: [{ fromUserId: actor.userId }, { toUserId: actor.userId }] };
}
