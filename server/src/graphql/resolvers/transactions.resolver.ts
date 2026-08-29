import { GraphQLError } from 'graphql';
import { Prisma } from '@prisma/client';
import { assertScope, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';
import transactionService from '../../services/transaction.service.js';
import type { TransactionWithSplits, UpdateTransactionWithSplits } from '../../../../shared/validation/index.js';

function rethrowAsGraphQLError(error: unknown): never {
  if (error instanceof Error) {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  throw error;
}

export const transactionsResolvers = {
  Query: {
    transactions: async (_: unknown, args: { propertyId?: string; leaseId?: string; type?: string; category?: string }, context: ApiContext) => {
      assertScope(context, 'transactions:read');
      const where: Prisma.TransactionWhereInput = { property: { ownerships: { some: { userId: context.apiKey!.userId } } } };
      if (args.propertyId) where.propertyId = args.propertyId;
      if (args.leaseId) where.leaseId = args.leaseId;
      if (args.type) where.type = args.type;
      if (args.category) where.category = args.category;
      return prisma.transaction.findMany({ where, include: { splits: true }, orderBy: { transactionDate: 'desc' } });
    },
    transaction: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'transactions:read');
      return prisma.transaction.findFirst({
        where: { id: args.id, property: { ownerships: { some: { userId: context.apiKey!.userId } } } },
        include: { splits: true },
      });
    },
  },
  Mutation: {
    createTransaction: async (_: unknown, args: { input: TransactionWithSplits }, context: ApiContext) => {
      assertScope(context, 'transactions:write');
      const property = await prisma.property.findFirst({
        where: { id: args.input.propertyId, ownerships: { some: { userId: context.apiKey!.userId } } },
      });
      if (!property) throw new GraphQLError('Property not found or access denied', { extensions: { code: 'FORBIDDEN' } });
      try {
        const transaction = await transactionService.createTransaction(args.input);
        return { ...transaction, splits: (transaction as { splits?: unknown[] }).splits ?? [] };
      } catch (error) {
        rethrowAsGraphQLError(error);
      }
    },
    updateTransaction: async (_: unknown, args: { id: string; input: UpdateTransactionWithSplits }, context: ApiContext) => {
      assertScope(context, 'transactions:write');
      const existing = await prisma.transaction.findFirst({
        where: { id: args.id, property: { ownerships: { some: { userId: context.apiKey!.userId } } } },
      });
      if (!existing) return null;
      try {
        const transaction = await transactionService.updateTransaction(args.id, args.input);
        return { ...transaction, splits: (transaction as { splits?: unknown[] }).splits ?? [] };
      } catch (error) {
        rethrowAsGraphQLError(error);
      }
    },
    deleteTransaction: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'transactions:write');
      const existing = await prisma.transaction.findFirst({
        where: { id: args.id, property: { ownerships: { some: { userId: context.apiKey!.userId } } } },
      });
      if (!existing) return false;
      await prisma.transaction.delete({ where: { id: args.id } });
      return true;
    },
  },
};
