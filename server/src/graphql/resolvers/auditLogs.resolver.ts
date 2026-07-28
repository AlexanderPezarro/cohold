import { assertScope, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';

export const auditLogsResolvers = {
  Query: {
    transactionAuditLogs: async (_: unknown, args: { transactionId?: string }, context: ApiContext) => {
      assertScope(context, 'transaction_audit_logs:read');
      const where: any = {};
      if (args.transactionId) where.transactionId = args.transactionId;
      return prisma.transactionAuditLog.findMany({ where, orderBy: { changedAt: 'desc' } });
    },
  },
};
