import { assertAccess, assertRole, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';

export const auditLogsResolvers = {
  Query: {
    transactionAuditLogs: async (_: unknown, args: { transactionId?: string }, context: ApiContext) => {
      assertAccess(context, 'transaction_audit_logs:read');
      assertRole(context, 'ADMIN');
      const where: any = {};
      if (args.transactionId) where.transactionId = args.transactionId;
      return prisma.transactionAuditLog.findMany({ where, orderBy: { changedAt: 'desc' } });
    },
  },
};
