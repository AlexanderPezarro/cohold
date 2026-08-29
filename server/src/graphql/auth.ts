import { GraphQLError } from 'graphql';
import { ApiKeyScope } from '../../../shared/types/apiKey.types.js';

/**
 * Unified GraphQL auth model for the two kinds of caller that can reach
 * `POST /api/v1/graphql`:
 *
 *  - **Session actor**: a logged-in browser user (session cookie). Carries a
 *    real `role` and the sentinel `scopes: 'full'` - it is not limited by an
 *    API-key scope list, so `assertAccess` always passes for it. Role-gated
 *    resolvers use `assertRole` against `actor.role`.
 *  - **API-key actor**: an `Authorization: Bearer chk_...` automation caller.
 *    Carries the key's literal `scopes` array and no meaningful `role` (API
 *    keys have never carried one). `assertAccess` reproduces the old
 *    `assertScope` byte-for-byte for these callers.
 *
 * DECISIONS (migration plan step 1.2, flagged open questions 5 & 7):
 *
 *  1. `assertScope` is renamed to `assertAccess`. For an API-key actor its
 *     pass/fail outcome is identical to the pre-migration `assertScope`
 *     (UNAUTHENTICATED with no actor, FORBIDDEN if the scope is absent). This
 *     is required by the hard backwards-compatibility constraint - existing
 *     n8n/automation keys must keep working unchanged.
 *  2. **Role checks are session-only.** `assertRole` is a no-op for API-key
 *     actors. REST's `requireAdmin`/`requireWrite` gates never applied to
 *     GraphQL API-key callers, and making them apply now would be a new
 *     rejection path for existing keys. API-key access is therefore governed
 *     purely by the key's scope list; a key with e.g. `pending_transactions:write`
 *     can perform that operation without being tied to an ADMIN user the way a
 *     session caller is. This keeps `apiKeyAuth` from having to do an extra
 *     per-request `user` lookup just to attach a role.
 *  3. `assertSessionOnly` rejects API-key actors outright (FORBIDDEN). Used by
 *     the api-keys-management mutations: an API key must never be able to mint
 *     or revoke API keys - that privilege-escalation path does not exist in
 *     REST today and must not be introduced.
 */

export type ActorScopes = 'full' | ApiKeyScope[];

export interface Actor {
  userId: string;
  /** Real role for session actors; '' for API-key actors (keys carry no role). */
  role: string;
  scopes: ActorScopes;
}

export interface ApiContext {
  actor: Actor | null;
}

/** True for a session actor (unrestricted by an API-key scope list). */
export function isFullActor(actor: Actor | null): actor is Actor {
  return actor != null && actor.scopes === 'full';
}

/** True only for a logged-in ADMIN session user - never for an API-key actor. */
export function isAdminActor(actor: Actor | null): boolean {
  return isFullActor(actor) && actor.role === 'ADMIN';
}

/**
 * Direct replacement for the pre-migration `assertScope`.
 * - no actor            -> UNAUTHENTICATED
 * - session actor        -> passes (not scoped by an API-key scope list)
 * - API-key actor        -> passes iff `scope` is in the key's scope list, else FORBIDDEN
 */
export function assertAccess(context: ApiContext, scope: ApiKeyScope): void {
  const { actor } = context;
  if (!actor) {
    throw new GraphQLError('Unauthenticated', { extensions: { code: 'UNAUTHENTICATED' } });
  }
  if (actor.scopes === 'full') return;
  if (!actor.scopes.includes(scope)) {
    throw new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } });
  }
}

const roleHierarchy: Record<string, number> = { ADMIN: 3, LANDLORD: 2, VIEWER: 1 };

/**
 * Role gate mirroring REST's `requireRole`. Session-only: API-key actors are
 * governed purely by their scope list (see decision 2 above) and pass straight
 * through. A missing/unknown session role ranks below everything.
 */
export function assertRole(context: ApiContext, requiredRole: 'ADMIN' | 'LANDLORD'): void {
  const { actor } = context;
  if (!actor) {
    throw new GraphQLError('Unauthenticated', { extensions: { code: 'UNAUTHENTICATED' } });
  }
  if (actor.scopes !== 'full') return; // API-key actor: scope list is the only gate
  const have = roleHierarchy[actor.role] ?? 0;
  const need = roleHierarchy[requiredRole] ?? 0;
  if (have < need) {
    throw new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } });
  }
}

/** Reject anything that is not a logged-in session user. */
export function assertSessionOnly(context: ApiContext): void {
  const { actor } = context;
  if (!actor) {
    throw new GraphQLError('Unauthenticated', { extensions: { code: 'UNAUTHENTICATED' } });
  }
  if (actor.scopes !== 'full') {
    throw new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } });
  }
}
