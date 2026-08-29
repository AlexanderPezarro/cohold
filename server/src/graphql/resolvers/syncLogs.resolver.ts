import { Prisma } from '@prisma/client';
import { assertScope, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';

export const syncLogsResolvers = {
  Query: {
    syncLogs: async (_: unknown, args: { bankAccountId?: string }, context: ApiContext) => {
      assertScope(context, 'sync_logs:read');
      const where: Prisma.SyncLogWhereInput = {};
      if (args.bankAccountId) where.bankAccountId = args.bankAccountId;
      return prisma.syncLog.findMany({ where, orderBy: { startedAt: 'desc' } });
    },
    syncLog: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'sync_logs:read');
      return prisma.syncLog.findUnique({ where: { id: args.id } });
    },
  },
};
