import { Prisma } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { assertAccess, ApiContext } from '../auth.js';
import { ownerPropertyRelationWhere, ownerPropertyWhere } from '../scoping.js';
import prisma from '../../db/client.js';

export const eventsResolvers = {
  Query: {
    events: async (_: unknown, args: { propertyId?: string; eventType?: string; completed?: boolean }, context: ApiContext) => {
      assertAccess(context, 'events:read');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dual-mode scope fragment (Record<string, unknown>) spread into a Prisma where
      const where: any = { ...ownerPropertyRelationWhere(context.actor!) };
      if (args.propertyId) where.propertyId = args.propertyId;
      if (args.eventType) where.eventType = args.eventType;
      if (args.completed !== undefined) where.completed = args.completed;
      return prisma.event.findMany({ where, orderBy: { scheduledDate: 'asc' } });
    },
    event: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'events:read');
      return prisma.event.findFirst({
        where: { id: args.id, ...ownerPropertyRelationWhere(context.actor!) },
      });
    },
  },
  Mutation: {
    createEvent: async (_: unknown, args: { input: Prisma.EventUncheckedCreateInput }, context: ApiContext) => {
      assertAccess(context, 'events:write');
      const property = await prisma.property.findFirst({
        where: { id: args.input.propertyId, ...ownerPropertyWhere(context.actor!) },
      });
      if (!property) throw new GraphQLError('Property not found or access denied', { extensions: { code: 'FORBIDDEN' } });
      return prisma.event.create({ data: args.input });
    },
    updateEvent: async (_: unknown, args: { id: string; input: Prisma.EventUncheckedUpdateInput }, context: ApiContext) => {
      assertAccess(context, 'events:write');
      const existing = await prisma.event.findFirst({
        where: { id: args.id, ...ownerPropertyRelationWhere(context.actor!) },
      });
      if (!existing) return null;
      return prisma.event.update({ where: { id: args.id }, data: args.input });
    },
    deleteEvent: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertAccess(context, 'events:write');
      const existing = await prisma.event.findFirst({
        where: { id: args.id, ...ownerPropertyRelationWhere(context.actor!) },
      });
      if (!existing) return false;
      await prisma.event.delete({ where: { id: args.id } });
      return true;
    },
  },
};
