export const API_KEY_SCOPES = {
  PROPERTIES_READ: 'properties:read',
  PROPERTIES_WRITE: 'properties:write',
  TENANTS_READ: 'tenants:read',
  TENANTS_WRITE: 'tenants:write',
  LEASES_READ: 'leases:read',
  LEASES_WRITE: 'leases:write',
  TRANSACTIONS_READ: 'transactions:read',
  TRANSACTIONS_WRITE: 'transactions:write',
  EVENTS_READ: 'events:read',
  EVENTS_WRITE: 'events:write',
  DOCUMENTS_READ: 'documents:read',
  DOCUMENTS_WRITE: 'documents:write',
  BANK_ACCOUNTS_READ: 'bank_accounts:read',
  BANK_ACCOUNTS_WRITE: 'bank_accounts:write',
  MATCHING_RULES_READ: 'matching_rules:read',
  MATCHING_RULES_WRITE: 'matching_rules:write',
  SETTLEMENTS_READ: 'settlements:read',
  SETTLEMENTS_WRITE: 'settlements:write',
  SYNC_LOGS_READ: 'sync_logs:read',
  TRANSACTION_AUDIT_LOGS_READ: 'transaction_audit_logs:read',
} as const;

export type ApiKeyScope = typeof API_KEY_SCOPES[keyof typeof API_KEY_SCOPES];

export interface ApiKeyListItem {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreateApiKeyRequest {
  name: string;
  scopes: ApiKeyScope[];
  expiresAt: string;
}

export interface CreateApiKeyResponse extends ApiKeyListItem {
  rawKey: string;
}
