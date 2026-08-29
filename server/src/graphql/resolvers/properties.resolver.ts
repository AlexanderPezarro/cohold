import { assertAccess, ApiContext } from '../auth.js';
import { ownerPropertyWhere } from '../scoping.js';
import prisma from '../../db/client.js';
import { buildPropertyStatusWhere, getPropertyStatus, type PropertyStatus } from '../../services/status.service.js';

const leaseDatesSelect = { startDate: true, endDate: true } as const;

export const propertiesResolvers = {
  Query: {
    properties: async (_: unknown, args: { status?: string; propertyType?: string; search?: string }, context: ApiContext) => {
      assertAccess(context, 'properties:read');
      const where: any = { ...ownerPropertyWhere(context.actor!) };
      if (args.status) Object.assign(where, buildPropertyStatusWhere(args.status as PropertyStatus));
      if (args.propertyType) where.propertyType = args.propertyType;
      if (args.search) where.OR = [
        { name: { contains: args.search } },
        { street: { contains: args.search } },
        { city: { contains: args.search } },
      ];
      return prisma.property.findMany({
        where,
        include: { leases: { select: leaseDatesSelect } },
        orderBy: { createdAt: 'desc' },
      });
    },
    property: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'properties:read');
      return prisma.property.findFirst({
        where: { id: args.id, ...ownerPropertyWhere(context.actor!) },
        include: { leases: { select: leaseDatesSelect } },
      });
    },
  },
  Mutation: {
    createProperty: async (_: unknown, args: { input: any }, context: ApiContext) => {
      assertAccess(context, 'properties:write');
      const property = await prisma.property.create({
        data: args.input,
        include: { leases: { select: leaseDatesSelect } },
      });
      // Mirrors REST POST /api/properties: the creator becomes the 100% owner so
      // ownership scoping has something to match on immediately.
      await prisma.propertyOwnership.create({
        data: { userId: context.actor!.userId, propertyId: property.id, ownershipPercentage: 100 },
      });
      return property;
    },
    updateProperty: async (_: unknown, args: { id: string; input: any }, context: ApiContext) => {
      assertAccess(context, 'properties:write');
      const existing = await prisma.property.findFirst({
        where: { id: args.id, ...ownerPropertyWhere(context.actor!) },
      });
      if (!existing) return null;
      return prisma.property.update({
        where: { id: args.id },
        data: args.input,
        include: { leases: { select: leaseDatesSelect } },
      });
    },
    deleteProperty: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'properties:write');
      const existing = await prisma.property.findFirst({
        where: { id: args.id, ...ownerPropertyWhere(context.actor!) },
      });
      if (!existing) return false;
      await prisma.property.delete({ where: { id: args.id } });
      return true;
    },
  },
  Property: {
    status: (parent: { listingState: string | null; leases: Array<{ startDate: Date; endDate: Date | null }> }) =>
      getPropertyStatus(parent),
  },
};
