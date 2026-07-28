import { GraphQLError } from 'graphql';
import { assertScope, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';

export const eventsResolvers = {
  Query: {
    events: async (_: unknown, args: { propertyId?: string; eventType?: string; completed?: boolean }, context: ApiContext) => {
      assertScope(context, 'events:read');
      const where: any = { property: { ownerships: { some: { userId: context.apiKey!.userId } } } };
      if (args.propertyId) where.propertyId = args.propertyId;
      if (args.eventType) where.eventType = args.eventType;
      if (args.completed !== undefined) where.completed = args.completed;
      return prisma.event.findMany({ where, orderBy: { scheduledDate: 'asc' } });
    },
    event: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'events:read');
      return prisma.event.findFirst({
        where: { id: args.id, property: { ownerships: { some: { userId: context.apiKey!.userId } } } },
      });
    },
  },
  Mutation: {
    createEvent: async (_: unknown, args: { input: any }, context: ApiContext) => {
      assertScope(context, 'events:write');
      const property = await prisma.property.findFirst({
        where: { id: args.input.propertyId, ownerships: { some: { userId: context.apiKey!.userId } } },
      });
      if (!property) throw new GraphQLError('Property not found or access denied', { extensions: { code: 'FORBIDDEN' } });
      return prisma.event.create({ data: args.input });
    },
    updateEvent: async (_: unknown, args: { id: string; input: any }, context: ApiContext) => {
      assertScope(context, 'events:write');
      const existing = await prisma.event.findFirst({
        where: { id: args.id, property: { ownerships: { some: { userId: context.apiKey!.userId } } } },
      });
      if (!existing) return null;
      return prisma.event.update({ where: { id: args.id }, data: args.input });
    },
    deleteEvent: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertScope(context, 'events:write');
      const existing = await prisma.event.findFirst({
        where: { id: args.id, property: { ownerships: { some: { userId: context.apiKey!.userId } } } },
      });
      if (!existing) return false;
      await prisma.event.delete({ where: { id: args.id } });
      return true;
    },
  },
};
