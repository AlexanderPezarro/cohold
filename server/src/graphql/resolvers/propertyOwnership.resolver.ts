import { GraphQLError } from 'graphql';
import { assertScope, ApiContext } from '../auth.js';
import propertyOwnershipService from '../../services/propertyOwnership.service.js';
import { DomainError, NotFoundError, ConflictError, ForbiddenError } from '../../services/errors.js';

function domainErrorToGraphQLCode(error: DomainError): string {
  if (error instanceof NotFoundError) return 'NOT_FOUND';
  if (error instanceof ConflictError) return 'CONFLICT';
  if (error instanceof ForbiddenError) return 'FORBIDDEN';
  return 'BAD_USER_INPUT';
}

function rethrowAsGraphQLError(error: unknown): never {
  if (error instanceof DomainError) {
    throw new GraphQLError(error.message, {
      extensions: { code: domainErrorToGraphQLCode(error) },
    });
  }
  if (error instanceof Error) {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  throw error;
}

export const propertyOwnershipResolvers = {
  Query: {
    propertyOwners: async (_: unknown, args: { propertyId: string }, context: ApiContext) => {
      assertScope(context, 'property_ownership:read');
      try {
        return await propertyOwnershipService.listOwners(args.propertyId);
      } catch (error) {
        rethrowAsGraphQLError(error);
      }
    },
  },
  Mutation: {
    addPropertyOwner: async (
      _: unknown,
      args: { propertyId: string; userId: string; ownershipPercentage: number },
      context: ApiContext
    ) => {
      assertScope(context, 'property_ownership:write');
      try {
        return await propertyOwnershipService.addOwner({
          propertyId: args.propertyId,
          userId: args.userId,
          ownershipPercentage: args.ownershipPercentage,
        });
      } catch (error) {
        rethrowAsGraphQLError(error);
      }
    },
    updatePropertyOwnership: async (
      _: unknown,
      args: { propertyId: string; userId: string; ownershipPercentage: number },
      context: ApiContext
    ) => {
      assertScope(context, 'property_ownership:write');
      try {
        return await propertyOwnershipService.updateOwnership(args.propertyId, args.userId, {
          ownershipPercentage: args.ownershipPercentage,
        });
      } catch (error) {
        rethrowAsGraphQLError(error);
      }
    },
    updatePropertyOwnershipSplits: async (
      _: unknown,
      args: {
        propertyId: string;
        splits: Array<{ userId: string; ownershipPercentage: number }>;
      },
      context: ApiContext
    ) => {
      assertScope(context, 'property_ownership:write');
      try {
        return await propertyOwnershipService.updateOwnershipSplits(
          args.propertyId,
          args.splits
        );
      } catch (error) {
        rethrowAsGraphQLError(error);
      }
    },
    removePropertyOwner: async (
      _: unknown,
      args: { propertyId: string; userId: string },
      context: ApiContext
    ) => {
      assertScope(context, 'property_ownership:write');
      try {
        await propertyOwnershipService.removeOwner(args.propertyId, args.userId);
        return true;
      } catch (error) {
        rethrowAsGraphQLError(error);
      }
    },
  },
};
