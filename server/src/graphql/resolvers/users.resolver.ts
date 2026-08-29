import { GraphQLError } from 'graphql';
import { assertAccess, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';
import authService from '../../services/auth.service.js';
import { CreateUserSchema } from '../../../../shared/validation/index.js';

export const usersResolvers = {
  Query: {
    users: async (_: unknown, __: unknown, context: ApiContext) => {
      assertAccess(context, 'users:read');
      return prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    },
  },
  Mutation: {
    createUser: async (
      _: unknown,
      args: { input: { email: string; password: string; role?: 'LANDLORD' | 'VIEWER' } },
      context: ApiContext
    ) => {
      assertAccess(context, 'users:write');

      const result = CreateUserSchema.safeParse({
        email: args.input.email,
        password: args.input.password,
        role: args.input.role ?? 'VIEWER',
      });
      if (!result.success) {
        throw new GraphQLError(result.error.issues[0].message, { extensions: { code: 'BAD_USER_INPUT' } });
      }
      const { email, password, role } = result.data;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new GraphQLError('Email address already registered', { extensions: { code: 'BAD_USER_INPUT' } });
      }

      return authService.createUser(email, password, role);
    },
  },
};
