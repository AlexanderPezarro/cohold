import { assertAccess, assertRole, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';

export const syncLogsResolvers = {
  Query: {
    syncLogs: async (_: unknown, args: { bankAccountId?: string }, context: ApiContext) => {
      assertAccess(context, 'sync_logs:read');
      assertRole(context, 'ADMIN');
      const where: any = {};
      if (args.bankAccountId) where.bankAccountId = args.bankAccountId;
      return prisma.syncLog.findMany({ where, orderBy: { startedAt: 'desc' } });
    },
    syncLog: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'sync_logs:read');
      assertRole(context, 'ADMIN');
      return prisma.syncLog.findUnique({ where: { id: args.id } });
    },
  },
};
