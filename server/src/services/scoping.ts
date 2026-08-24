// server/src/services/scoping.ts
//
// Shared ownership-scoping helpers for REST routes, mirroring the scoping already
// enforced by the GraphQL resolvers (server/src/graphql/resolvers/*.resolver.ts):
// a non-admin user may only see/act on properties they own (via PropertyOwnership);
// an ADMIN bypasses scoping entirely and sees everything.
//
// Use these to build Prisma `where` clauses. For list endpoints, merge the
// returned object into your existing `where` (e.g. `Object.assign(where, propertyScope(user))`).
// For single-resource read/update/delete, prefer `findFirst({ where: { id, ...scope } })`
// over `findUnique` + a separate ownership check - findFirst returns null both when the
// id doesn't exist AND when it exists but isn't in scope, which is exactly the
// 404-for-both behaviour these routes want (see each route file for the 404-vs-403 rationale).

export interface ScopeUser {
  id: string;
  role: string;
}

function isAdmin(user: ScopeUser): boolean {
  return user.role === 'ADMIN';
}

/**
 * Scope for a direct Property query/mutation.
 * Non-admin: only properties they have a PropertyOwnership row for.
 * Admin: no restriction.
 */
export function propertyScope(user: ScopeUser): Record<string, unknown> {
  return isAdmin(user) ? {} : { ownerships: { some: { userId: user.id } } };
}

/**
 * Scope for entities that reach Property through a direct, required `property`
 * relation (Lease, Transaction, Event - anything with a `propertyId` foreign key
 * and a corresponding `property` relation field).
 * Non-admin: only rows whose property is owned by them.
 * Admin: no restriction.
 */
export function propertyRelationScope(user: ScopeUser): Record<string, unknown> {
  return isAdmin(user) ? {} : { property: { ownerships: { some: { userId: user.id } } } };
}

/**
 * Scope for Tenant, which has no direct property relation - it reaches Property
 * only via its Leases. A tenant is in-scope if at least one of its leases is for
 * a property the user owns. A tenant with zero leases at all has no ownership
 * path and is therefore out of scope for non-admins (this matches the existing
 * GraphQL `tenants`/`tenant` resolvers, which use the identical predicate).
 * Admin: no restriction.
 */
export function tenantScope(user: ScopeUser): Record<string, unknown> {
  return isAdmin(user)
    ? {}
    : { leases: { some: { property: { ownerships: { some: { userId: user.id } } } } } };
}
