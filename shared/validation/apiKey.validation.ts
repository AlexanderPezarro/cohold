import { z } from 'zod';

const ALL_SCOPES = [
  'properties:read', 'properties:write',
  'tenants:read', 'tenants:write',
  'leases:read', 'leases:write',
  'transactions:read', 'transactions:write',
  'events:read', 'events:write',
  'documents:read', 'documents:write',
  'bank_accounts:read', 'bank_accounts:write',
  'matching_rules:read', 'matching_rules:write',
  'settlements:read', 'settlements:write',
  'sync_logs:read',
  'transaction_audit_logs:read',
  'users:read', 'users:write',
  'property_ownership:read', 'property_ownership:write',
  // Scopes for surface unified from REST into GraphQL (see
  // shared/types/apiKey.types.ts API_KEY_SCOPES). Listed here so a key can
  // actually be minted with them.
  'pending_transactions:read', 'pending_transactions:write',
  'reports:read',
  'webhook_status:read',
  'api_keys:read', 'api_keys:write',
] as const;

export const ApiKeyScopeSchema = z.enum(ALL_SCOPES);

export const CreateApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  scopes: z.array(ApiKeyScopeSchema).min(1, 'At least one scope is required'),
  expiresAt: z.string()
    .datetime({ message: 'Must be a valid ISO datetime' })
    .refine(d => new Date(d) > new Date(), { message: 'Expiry must be in the future' })
    .refine(d => {
      const max = new Date();
      max.setFullYear(max.getFullYear() + 1);
      return new Date(d) <= max;
    }, { message: 'Expiry must be within 1 year' }),
});

export const RevokeApiKeySchema = z.object({
  id: z.string().uuid(),
});

export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;
export type CreateApiKey = z.infer<typeof CreateApiKeySchema>;
export type RevokeApiKey = z.infer<typeof RevokeApiKeySchema>;
