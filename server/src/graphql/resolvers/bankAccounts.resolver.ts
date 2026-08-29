import { assertAccess, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';

export const bankAccountsResolvers = {
  Query: {
    bankAccounts: async (_: unknown, __: unknown, context: ApiContext) => {
      assertAccess(context, 'bank_accounts:read');
      return prisma.bankAccount.findMany({ orderBy: { createdAt: 'desc' } });
    },
    bankAccount: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'bank_accounts:read');
      return prisma.bankAccount.findUnique({ where: { id: args.id } });
    },
  },
};
