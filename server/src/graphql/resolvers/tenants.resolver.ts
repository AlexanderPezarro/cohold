import { assertScope, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';

export const tenantsResolvers = {
  Query: {
    tenants: async (_: unknown, args: { status?: string; search?: string }, context: ApiContext) => {
      assertScope(context, 'tenants:read');
      const where: any = { leases: { some: { property: { ownerships: { some: { userId: context.apiKey!.userId } } } } } };
      if (args.status) where.status = args.status;
      if (args.search) where.OR = [
        { firstName: { contains: args.search } },
        { lastName: { contains: args.search } },
        { email: { contains: args.search } },
      ];
      return prisma.tenant.findMany({ where, orderBy: { createdAt: 'desc' } });
    },
    tenant: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'tenants:read');
      return prisma.tenant.findFirst({
        where: { id: args.id, leases: { some: { property: { ownerships: { some: { userId: context.apiKey!.userId } } } } } },
      });
    },
  },
  Mutation: {
    createTenant: async (_: unknown, args: { input: any }, context: ApiContext) => {
      assertScope(context, 'tenants:write');
      return prisma.tenant.create({ data: args.input });
    },
    updateTenant: async (_: unknown, args: { id: string; input: any }, context: ApiContext) => {
      assertScope(context, 'tenants:write');
      const existing = await prisma.tenant.findFirst({
        where: {
          id: args.id,
          leases: { some: { property: { ownerships: { some: { userId: context.apiKey!.userId } } } } },
        },
      });
      if (!existing) return null;
      return prisma.tenant.update({ where: { id: args.id }, data: args.input });
    },
    deleteTenant: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'tenants:write');
      const existing = await prisma.tenant.findFirst({
        where: {
          id: args.id,
          leases: { some: { property: { ownerships: { some: { userId: context.apiKey!.userId } } } } },
        },
      });
      if (!existing) return false;
      await prisma.tenant.delete({ where: { id: args.id } });
      return true;
    },
  },
};
