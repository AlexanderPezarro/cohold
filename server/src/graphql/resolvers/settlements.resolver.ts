import { Prisma } from '@prisma/client';
import { assertScope, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';

export const settlementsResolvers = {
  Query: {
    settlements: async (_: unknown, args: { propertyId?: string }, context: ApiContext) => {
      assertScope(context, 'settlements:read');
      const where: Prisma.SettlementWhereInput = {
        OR: [{ fromUserId: context.apiKey!.userId }, { toUserId: context.apiKey!.userId }],
      };
      if (args.propertyId) where.propertyId = args.propertyId;
      return prisma.settlement.findMany({ where, orderBy: { settlementDate: 'desc' } });
    },
    settlement: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'settlements:read');
      return prisma.settlement.findFirst({
        where: {
          id: args.id,
          OR: [{ fromUserId: context.apiKey!.userId }, { toUserId: context.apiKey!.userId }],
        },
      });
    },
  },
  Mutation: {
    createSettlement: async (_: unknown, args: { input: Prisma.SettlementUncheckedCreateInput }, context: ApiContext) => {
      assertScope(context, 'settlements:write');
      return prisma.settlement.create({ data: { ...args.input, fromUserId: context.apiKey!.userId } });
    },
    updateSettlement: async (_: unknown, args: { id: string; input: Prisma.SettlementUncheckedUpdateInput }, context: ApiContext) => {
      assertScope(context, 'settlements:write');
      const existing = await prisma.settlement.findFirst({
        where: {
          id: args.id,
          OR: [{ fromUserId: context.apiKey!.userId }, { toUserId: context.apiKey!.userId }],
        },
      });
      if (!existing) return null;
      return prisma.settlement.update({ where: { id: args.id }, data: args.input });
    },
    deleteSettlement: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'settlements:write');
      const existing = await prisma.settlement.findFirst({
        where: {
          id: args.id,
          OR: [{ fromUserId: context.apiKey!.userId }, { toUserId: context.apiKey!.userId }],
        },
      });
      if (!existing) return false;
      await prisma.settlement.delete({ where: { id: args.id } });
      return true;
    },
  },
};
