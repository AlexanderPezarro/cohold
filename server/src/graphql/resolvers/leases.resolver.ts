import { GraphQLError } from 'graphql';
import { assertScope, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';

export const leasesResolvers = {
  Query: {
    leases: async (_: unknown, args: { propertyId?: string; tenantId?: string; status?: string }, context: ApiContext) => {
      assertScope(context, 'leases:read');
      const where: any = { property: { ownerships: { some: { userId: context.apiKey!.userId } } } };
      if (args.propertyId) where.propertyId = args.propertyId;
      if (args.tenantId) where.tenantId = args.tenantId;
      if (args.status) where.status = args.status;
      return prisma.lease.findMany({ where, orderBy: { createdAt: 'desc' } });
    },
    lease: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'leases:read');
      return prisma.lease.findFirst({
        where: { id: args.id, property: { ownerships: { some: { userId: context.apiKey!.userId } } } },
      });
    },
  },
  Mutation: {
    createLease: async (_: unknown, args: { input: any }, context: ApiContext) => {
      assertScope(context, 'leases:write');
      const property = await prisma.property.findFirst({
        where: { id: args.input.propertyId, ownerships: { some: { userId: context.apiKey!.userId } } },
      });
      if (!property) throw new GraphQLError('Property not found or access denied', { extensions: { code: 'FORBIDDEN' } });
      return prisma.lease.create({ data: args.input });
    },
    updateLease: async (_: unknown, args: { id: string; input: any }, context: ApiContext) => {
      assertScope(context, 'leases:write');
      const existing = await prisma.lease.findFirst({
        where: { id: args.id, property: { ownerships: { some: { userId: context.apiKey!.userId } } } },
      });
      if (!existing) return null;
      return prisma.lease.update({ where: { id: args.id }, data: args.input });
    },
    deleteLease: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'leases:write');
      const existing = await prisma.lease.findFirst({
        where: { id: args.id, property: { ownerships: { some: { userId: context.apiKey!.userId } } } },
      });
      if (!existing) return false;
      await prisma.lease.delete({ where: { id: args.id } });
      return true;
    },
  },
};
