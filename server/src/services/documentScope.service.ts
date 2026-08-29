// server/src/services/documentScope.service.ts
//
// Ownership scoping for Document, extracted from server/src/routes/documents.ts
// so the REST byte-handling routes (upload/download) and the GraphQL
// `documents`/`document`/`deleteDocument` resolvers share one implementation
// rather than each carrying their own copy (migration plan step 3).
//
// Documents are polymorphically associated (entityType + entityId) with no
// DB-level foreign key, so ownership can't be expressed as a single Prisma
// relation filter the way it can for Lease/Event/Transaction. Instead we
// resolve, per entityType, which entityIds of that type the caller may see (or,
// for one document, whether its single entity is in scope), reusing the same
// property-ownership predicates as every other resource.

import prisma from '../db/client.js';
import { propertyScope, propertyRelationScope, tenantScope, type ScopeUser } from './scoping.js';

/** Whether a single (entityType, entityId) pair is visible to this user. ADMIN sees all. */
export async function isEntityAccessible(
  entityType: string,
  entityId: string,
  user: ScopeUser
): Promise<boolean> {
  if (user.role === 'ADMIN') return true;

  switch (entityType) {
    case 'Property':
      return (
        (await prisma.property.findFirst({ where: { id: entityId, ...propertyScope(user) }, select: { id: true } })) !== null
      );
    case 'Tenant':
      return (
        (await prisma.tenant.findFirst({ where: { id: entityId, ...tenantScope(user) }, select: { id: true } })) !== null
      );
    case 'Lease':
      return (
        (await prisma.lease.findFirst({ where: { id: entityId, ...propertyRelationScope(user) }, select: { id: true } })) !== null
      );
    case 'Transaction':
      return (
        (await prisma.transaction.findFirst({ where: { id: entityId, ...propertyRelationScope(user) }, select: { id: true } })) !== null
      );
    default:
      return false;
  }
}

/**
 * A Prisma DocumentWhereInput restricting results to documents whose entity is
 * in scope for this user, across all entity types at once. ADMIN gets `{}`.
 */
export async function documentScopeWhere(user: ScopeUser): Promise<Record<string, unknown>> {
  if (user.role === 'ADMIN') return {};

  const [properties, tenants, leases, transactions] = await Promise.all([
    prisma.property.findMany({ where: propertyScope(user), select: { id: true } }),
    prisma.tenant.findMany({ where: tenantScope(user), select: { id: true } }),
    prisma.lease.findMany({ where: propertyRelationScope(user), select: { id: true } }),
    prisma.transaction.findMany({ where: propertyRelationScope(user), select: { id: true } }),
  ]);

  return {
    OR: [
      { entityType: 'Property', entityId: { in: properties.map((p) => p.id) } },
      { entityType: 'Tenant', entityId: { in: tenants.map((t) => t.id) } },
      { entityType: 'Lease', entityId: { in: leases.map((l) => l.id) } },
      { entityType: 'Transaction', entityId: { in: transactions.map((t) => t.id) } },
    ],
  };
}
