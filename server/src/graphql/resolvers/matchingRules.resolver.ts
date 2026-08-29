import { Prisma } from '@prisma/client';
import { assertAccess, assertRole, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';

export const matchingRulesResolvers = {
  Query: {
    matchingRules: async (_: unknown, args: { bankAccountId?: string }, context: ApiContext) => {
      assertAccess(context, 'matching_rules:read');
      assertRole(context, 'ADMIN');
      const where: Prisma.MatchingRuleWhereInput = {};
      if (args.bankAccountId) where.bankAccountId = args.bankAccountId;
      return prisma.matchingRule.findMany({ where, orderBy: [{ priority: 'asc' }] });
    },
    matchingRule: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'matching_rules:read');
      assertRole(context, 'ADMIN');
      return prisma.matchingRule.findUnique({ where: { id: args.id } });
    },
  },
  Mutation: {
    createMatchingRule: async (_: unknown, args: { input: Prisma.MatchingRuleUncheckedCreateInput }, context: ApiContext) => {
      assertAccess(context, 'matching_rules:write');
      assertRole(context, 'ADMIN');
      return prisma.matchingRule.create({ data: args.input });
    },
    updateMatchingRule: async (_: unknown, args: { id: string; input: Prisma.MatchingRuleUncheckedUpdateInput }, context: ApiContext) => {
      assertAccess(context, 'matching_rules:write');
      assertRole(context, 'ADMIN');
      const existing = await prisma.matchingRule.findUnique({ where: { id: args.id } });
      if (!existing) return null;
      return prisma.matchingRule.update({ where: { id: args.id }, data: args.input });
    },
    deleteMatchingRule: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'matching_rules:write');
      assertRole(context, 'ADMIN');
      const existing = await prisma.matchingRule.findUnique({ where: { id: args.id } });
      if (!existing) return false;
      await prisma.matchingRule.delete({ where: { id: args.id } });
      return true;
    },
  },
};
