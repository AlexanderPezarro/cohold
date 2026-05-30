import { GraphQLError } from 'graphql';
import { ApiKeyScope } from '../../../shared/types/apiKey.types.js';

export interface ApiContext {
  apiKey: { id: string; userId: string; scopes: ApiKeyScope[] } | null;
}

export function assertScope(context: ApiContext, scope: ApiKeyScope): void {
  if (!context.apiKey) {
    throw new GraphQLError('Unauthenticated', { extensions: { code: 'UNAUTHENTICATED' } });
  }
  if (!context.apiKey.scopes.includes(scope)) {
    throw new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } });
  }
}
