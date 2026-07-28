import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import type { Express } from 'express';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';
import { typeDefs } from './schema.js';
import { resolvers } from './resolvers/index.js';
import type { ApiContext } from './auth.js';

export async function initGraphQL(app: Express): Promise<void> {
  const server = new ApolloServer<ApiContext>({
    typeDefs,
    resolvers,
    introspection: process.env.NODE_ENV !== 'production',
    plugins: [ApolloServerPluginLandingPageDisabled()],
  });

  await server.start();

  app.use(
    '/api/v1/graphql',
    apiKeyAuth,
    expressMiddleware(server, {
      context: async ({ req }) => ({
        apiKey: req.apiKey ?? null,
      }),
    }),
  );
}
