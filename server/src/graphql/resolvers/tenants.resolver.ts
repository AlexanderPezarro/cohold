import { Prisma } from '@prisma/client';
import { assertScope, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';
import { buildTenantStatusWhere, getTenantStatus, type TenantStatus } from '../../services/status.service.js';

const leaseDatesSelect = { startDate: true, endDate: true } as const;

export const tenantsResolvers = {
  Query: {
    tenants: async (_: unknown, args: { status?: string; search?: string }, context: ApiContext) => {
      assertScope(context, 'tenants:read');
      const where: Prisma.TenantWhereInput = { leases: { some: { property: { ownerships: { some: { userId: context.apiKey!.userId } } } } } };
      if (args.status) Object.assign(where, buildTenantStatusWhere(args.status as TenantStatus));
      if (args.search) where.OR = [
        { firstName: { contains: args.search } },
        { lastName: { contains: args.search } },
        { email: { contains: args.search } },
      ];
      return prisma.tenant.findMany({
        where,
        include: { leases: { select: leaseDatesSelect } },
        orderBy: { createdAt: 'desc' },
      });
    },
    tenant: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'tenants:read');
      return prisma.tenant.findFirst({
        where: { id: args.id, leases: { some: { property: { ownerships: { some: { userId: context.apiKey!.userId } } } } } },
        include: { leases: { select: leaseDatesSelect } },
      });
    },
  },
  Mutation: {
    createTenant: async (_: unknown, args: { input: Prisma.TenantUncheckedCreateInput }, context: ApiContext) => {
      assertScope(context, 'tenants:write');
      return prisma.tenant.create({
        data: args.input,
        include: { leases: { select: leaseDatesSelect } },
      });
    },
    updateTenant: async (_: unknown, args: { id: string; input: Prisma.TenantUncheckedUpdateInput }, context: ApiContext) => {
      assertScope(context, 'tenants:write');
      const existing = await prisma.tenant.findFirst({
        where: {
          id: args.id,
          leases: { some: { property: { ownerships: { some: { userId: context.apiKey!.userId } } } } },
        },
      });
      if (!existing) return null;
      return prisma.tenant.update({
        where: { id: args.id },
        data: args.input,
        include: { leases: { select: leaseDatesSelect } },
      });
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
  Tenant: {
    status: (parent: { leases: Array<{ startDate: Date; endDate: Date | null }> }) => getTenantStatus(parent),
  },
};
