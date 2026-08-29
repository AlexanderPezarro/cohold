import { Prisma } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { assertAccess, ApiContext, isFullActor } from '../auth.js';
import prisma from '../../db/client.js';
import { LocalStorageService } from '../../services/storage/LocalStorageService.js';
import {
  documentScopeWhere,
  isEntityAccessible,
} from '../../services/documentScope.service.js';
import type { ScopeUser } from '../../services/scoping.js';

const storageService = new LocalStorageService();

// Dual-mode scoping (migration plan Risk 6):
//  - **Session actor**: apply the same per-entity ownership scoping REST enforces
//    (documentScopeWhere / isEntityAccessible), so a logged-in landlord can only
//    see/delete documents attached to entities they own; a session ADMIN sees all.
//  - **API-key actor**: unchanged from the pre-migration resolver - no scoping.
//    Automation keys with `documents:read`/`write` are a trusted,
//    deployment-controlled surface, and the hard backwards-compatibility
//    constraint requires their behaviour to stay byte-for-byte identical.
function sessionScopeUser(context: ApiContext): ScopeUser | null {
  const actor = context.actor;
  if (!isFullActor(actor)) return null;
  return { id: actor.userId, role: actor.role };
}

export const documentsResolvers = {
  Query: {
    documents: async (_: unknown, args: { entityType?: string; entityId?: string }, context: ApiContext) => {
      assertAccess(context, 'documents:read');
      const where: Prisma.DocumentWhereInput = {};
      if (args.entityType) where.entityType = args.entityType;
      if (args.entityId) where.entityId = args.entityId;

      const scopeUser = sessionScopeUser(context);
      if (scopeUser) Object.assign(where, await documentScopeWhere(scopeUser));

      return prisma.document.findMany({ where, orderBy: { uploadedAt: 'desc' } });
    },
    document: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'documents:read');
      const document = await prisma.document.findUnique({ where: { id: args.id } });
      if (!document) return null;

      const scopeUser = sessionScopeUser(context);
      if (scopeUser && !(await isEntityAccessible(document.entityType, document.entityId, scopeUser))) {
        return null;
      }
      return document;
    },
  },
  Mutation: {
    // Mirrors REST `DELETE /api/documents/:id`: scope check (404-as-null for both
    // missing and out-of-scope), then storage delete followed by DB delete.
    // Document *creation* deliberately stays on the REST multipart upload
    // endpoint (see server/src/routes/documents.ts) - there is no clean
    // "create metadata only" path to move.
    deleteDocument: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'documents:write');
      const document = await prisma.document.findUnique({ where: { id: args.id } });
      if (!document) return false;

      const scopeUser = sessionScopeUser(context);
      if (scopeUser && !(await isEntityAccessible(document.entityType, document.entityId, scopeUser))) {
        return false;
      }

      try {
        await storageService.deleteFile(document.filePath);
      } catch (error) {
        // Match REST: a storage-layer error surfaces rather than being swallowed.
        const message = error instanceof Error ? error.message : 'Failed to delete document file';
        throw new GraphQLError(message, { extensions: { code: 'INTERNAL_SERVER_ERROR' } });
      }
      await prisma.document.delete({ where: { id: args.id } });
      return true;
    },
  },
};
