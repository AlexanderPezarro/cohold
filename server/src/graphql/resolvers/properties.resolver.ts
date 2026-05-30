import { assertScope, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';

export const propertiesResolvers = {
  Query: {
    properties: async (_: unknown, args: { status?: string; propertyType?: string; search?: string }, context: ApiContext) => {
      assertScope(context, 'properties:read');
      const where: any = { ownerships: { some: { userId: context.apiKey!.userId } } };
      if (args.status) where.status = args.status;
      if (args.propertyType) where.propertyType = args.propertyType;
      if (args.search) where.OR = [
        { name: { contains: args.search } },
        { street: { contains: args.search } },
        { city: { contains: args.search } },
      ];
      return prisma.property.findMany({ where, orderBy: { createdAt: 'desc' } });
    },
    property: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'properties:read');
      return prisma.property.findFirst({
        where: { id: args.id, ownerships: { some: { userId: context.apiKey!.userId } } },
      });
    },
  },
  Mutation: {
    createProperty: async (_: unknown, args: { input: any }, context: ApiContext) => {
      assertScope(context, 'properties:write');
      const property = await prisma.property.create({ data: args.input });
      await prisma.propertyOwnership.create({
        data: { userId: context.apiKey!.userId, propertyId: property.id, ownershipPercentage: 100 },
      });
      return property;
    },
    updateProperty: async (_: unknown, args: { id: string; input: any }, context: ApiContext) => {
      assertScope(context, 'properties:write');
      const existing = await prisma.property.findFirst({
        where: { id: args.id, ownerships: { some: { userId: context.apiKey!.userId } } },
      });
      if (!existing) return null;
      return prisma.property.update({ where: { id: args.id }, data: args.input });
    },
    deleteProperty: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'properties:write');
      const existing = await prisma.property.findFirst({
        where: { id: args.id, ownerships: { some: { userId: context.apiKey!.userId } } },
      });
      if (!existing) return false;
      await prisma.property.delete({ where: { id: args.id } });
      return true;
    },
  },
};
