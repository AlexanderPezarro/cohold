import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import type { Express } from 'express';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';
import prisma from '../db/client.js';
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

  // `apiKeyAuth` runs first (best-effort: attaches `req.apiKey` when a valid
  // `Bearer chk_...` header is present, 401s only on an invalid/expired/revoked
  // one, no-ops otherwise). The session middleware from `createApp()` has
  // already run by the time this context builder executes, so `req.session` is
  // available here with no reordering.
  //
  // Actor resolution order: a logged-in session wins over an API key if both
  // are somehow present, because a session actor is strictly more privileged
  // (unrestricted by a scope list).
  app.use(
    '/api/v1/graphql',
    apiKeyAuth,
    expressMiddleware(server, {
      context: async ({ req }): Promise<ApiContext> => {
        if (req.session?.userId) {
          const user = await prisma.user.findUnique({
            where: { id: req.session.userId },
            select: { id: true, role: true },
          });
          if (user) {
            return { actor: { userId: user.id, role: user.role, scopes: 'full' } };
          }
        }
        if (req.apiKey) {
          // API keys carry no role; role checks are session-only (see auth.ts).
          return { actor: { userId: req.apiKey.userId, role: '', scopes: req.apiKey.scopes } };
        }
        return { actor: null };
      },
    }),
  );
}
