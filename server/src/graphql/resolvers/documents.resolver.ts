import { Prisma } from '@prisma/client';
import { assertScope, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';

export const documentsResolvers = {
  Query: {
    documents: async (_: unknown, args: { entityType?: string; entityId?: string }, context: ApiContext) => {
      assertScope(context, 'documents:read');
      const where: Prisma.DocumentWhereInput = {};
      if (args.entityType) where.entityType = args.entityType;
      if (args.entityId) where.entityId = args.entityId;
      return prisma.document.findMany({ where, orderBy: { uploadedAt: 'desc' } });
    },
    document: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'documents:read');
      return prisma.document.findUnique({ where: { id: args.id } });
    },
  },
};
