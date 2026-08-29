import { Prisma } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { assertAccess, ApiContext } from '../auth.js';
import { ownerPropertyRelationWhere, ownerPropertyWhere } from '../scoping.js';
import prisma from '../../db/client.js';
import { buildLeaseStatusWhere, getLeaseStatus, type LeaseStatus } from '../../services/status.service.js';

export const leasesResolvers = {
  Query: {
    leases: async (_: unknown, args: { propertyId?: string; tenantId?: string; status?: string }, context: ApiContext) => {
      assertAccess(context, 'leases:read');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dual-mode scope fragment (Record<string, unknown>) spread into a Prisma where
      const where: any = { ...ownerPropertyRelationWhere(context.actor!) };
      if (args.propertyId) where.propertyId = args.propertyId;
      if (args.tenantId) where.tenantId = args.tenantId;
      if (args.status) Object.assign(where, buildLeaseStatusWhere(args.status as LeaseStatus));
      return prisma.lease.findMany({ where, orderBy: { createdAt: 'desc' } });
    },
    lease: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'leases:read');
      return prisma.lease.findFirst({
        where: { id: args.id, ...ownerPropertyRelationWhere(context.actor!) },
      });
    },
  },
  Mutation: {
    createLease: async (_: unknown, args: { input: Prisma.LeaseUncheckedCreateInput }, context: ApiContext) => {
      assertAccess(context, 'leases:write');
      const property = await prisma.property.findFirst({
        where: { id: args.input.propertyId, ...ownerPropertyWhere(context.actor!) },
      });
      if (!property) throw new GraphQLError('Property not found or access denied', { extensions: { code: 'FORBIDDEN' } });
      return prisma.lease.create({ data: args.input });
    },
    updateLease: async (_: unknown, args: { id: string; input: Prisma.LeaseUncheckedUpdateInput }, context: ApiContext) => {
      assertAccess(context, 'leases:write');
      const existing = await prisma.lease.findFirst({
        where: { id: args.id, ...ownerPropertyRelationWhere(context.actor!) },
      });
      if (!existing) return null;
      return prisma.lease.update({ where: { id: args.id }, data: args.input });
    },
    deleteLease: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'leases:write');
      const existing = await prisma.lease.findFirst({
        where: { id: args.id, ...ownerPropertyRelationWhere(context.actor!) },
      });
      if (!existing) return false;
      await prisma.lease.delete({ where: { id: args.id } });
      return true;
    },
  },
  Lease: {
    status: (parent: { startDate: Date; endDate: Date | null }) => getLeaseStatus(parent),
  },
};
