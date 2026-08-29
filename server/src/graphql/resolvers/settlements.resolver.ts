import { assertAccess, ApiContext } from '../auth.js';
import { ownerSettlementWhere } from '../scoping.js';
import prisma from '../../db/client.js';

export const settlementsResolvers = {
  Query: {
    settlements: async (_: unknown, args: { propertyId?: string }, context: ApiContext) => {
      assertAccess(context, 'settlements:read');
      const where: any = { ...ownerSettlementWhere(context.actor!) };
      if (args.propertyId) where.propertyId = args.propertyId;
      return prisma.settlement.findMany({ where, orderBy: { settlementDate: 'desc' } });
    },
    settlement: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'settlements:read');
      return prisma.settlement.findFirst({
        where: { id: args.id, ...ownerSettlementWhere(context.actor!) },
      });
    },
  },
  Mutation: {
    createSettlement: async (_: unknown, args: { input: any }, context: ApiContext) => {
      assertAccess(context, 'settlements:write');
      // fromUserId is always the caller's own identity, ignoring any value in the
      // input (unchanged from the pre-migration resolver).
      return prisma.settlement.create({ data: { ...args.input, fromUserId: context.actor!.userId } });
    },
    updateSettlement: async (_: unknown, args: { id: string; input: any }, context: ApiContext) => {
      assertAccess(context, 'settlements:write');
      const existing = await prisma.settlement.findFirst({
        where: { id: args.id, ...ownerSettlementWhere(context.actor!) },
      });
      if (!existing) return null;
      return prisma.settlement.update({ where: { id: args.id }, data: args.input });
    },
    deleteSettlement: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'settlements:write');
      const existing = await prisma.settlement.findFirst({
        where: { id: args.id, ...ownerSettlementWhere(context.actor!) },
      });
      if (!existing) return false;
      await prisma.settlement.delete({ where: { id: args.id } });
      return true;
    },
  },
};
