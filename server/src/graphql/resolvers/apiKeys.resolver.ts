import crypto from 'crypto';
import { GraphQLError } from 'graphql';
import { assertSessionOnly, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';
import { CreateApiKeySchema } from '../../../../shared/validation/index.js';

// Net-new resolver mirroring REST server/src/routes/api-keys.ts (all requireAuth,
// session-only - no API key can manage API keys today).
//
// assertSessionOnly enforces that: an API-key actor is rejected outright,
// regardless of scope. Letting a key mint or revoke keys would be a
// privilege-escalation path that does not exist in REST and must not be
// introduced by the migration.

const publicKeySelect = {
  id: true,
  userId: true,
  name: true,
  keyPrefix: true,
  scopes: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
} as const;

type RawKeyRow = {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

function shape(row: RawKeyRow) {
  return { ...row, scopes: JSON.parse(row.scopes) as string[] };
}

export const apiKeysResolvers = {
  Query: {
    apiKeys: async (_: unknown, __: unknown, context: ApiContext) => {
      assertSessionOnly(context);
      const rows = await prisma.apiKey.findMany({
        where: { userId: context.actor!.userId },
        select: publicKeySelect,
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(shape);
    },
  },
  Mutation: {
    createApiKey: async (
      _: unknown,
      args: { input: { name: string; scopes: string[]; expiresAt: string } },
      context: ApiContext
    ) => {
      assertSessionOnly(context);

      const result = CreateApiKeySchema.safeParse(args.input);
      if (!result.success) {
        throw new GraphQLError(result.error.issues[0].message, { extensions: { code: 'BAD_USER_INPUT' } });
      }
      const { name, scopes, expiresAt } = result.data;

      const rawKey = 'chk_' + crypto.randomBytes(32).toString('base64url');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.slice(4, 12);

      const row = await prisma.apiKey.create({
        data: {
          userId: context.actor!.userId,
          name,
          keyHash,
          keyPrefix,
          scopes: JSON.stringify(scopes),
          expiresAt: new Date(expiresAt),
        },
        select: publicKeySelect,
      });

      return { ...shape(row), rawKey };
    },
    revokeApiKey: async (_: unknown, args: { id: string }, context: ApiContext) => {
      assertSessionOnly(context);
      const key = await prisma.apiKey.findUnique({ where: { id: args.id } });
      // Scoped to the caller's own keys; anything else is "not found" (matches REST).
      if (!key || key.userId !== context.actor!.userId) return false;
      await prisma.apiKey.update({ where: { id: args.id }, data: { revokedAt: new Date() } });
      return true;
    },
  },
};
