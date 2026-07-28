# GraphQL API + API Key Authentication — Design

**Date:** 2026-05-30

## Overview

Cohold needs a machine/agent API so personal automation scripts, n8n flows, and AI agents can interact with the portfolio without session cookies. The design uses GraphQL (Apollo Server 4) at `POST /api/v1/graphql`, authenticated via `Authorization: Bearer chk_<token>` API keys with resource-level scopes. Keys are managed via a new Settings section and stored as SHA-256 hashes. All Prisma models are exposed; full CRUD is gated by per-key scopes.

## Consumer

Personal automation (single-tenant). Not a multi-tenant OAuth system — simple API keys only.

## Authentication

- **Token format**: `chk_<32-bytes-base64url>` — the `chk_` prefix makes keys identifiable in logs and scannable by secret-scanning tools
- **Storage**: SHA-256 hex hash stored in DB, raw key never persisted
- **Transport**: `Authorization: Bearer chk_...` header
- **Expiry**: Mandatory on all keys (max 1 year from creation)
- **Revocation**: Soft delete (`revokedAt` timestamp), immediate effect

## Scopes

Resource-level scopes, 20 total:

| Resource | Read | Write |
|---|---|---|
| properties | ✓ | ✓ |
| tenants | ✓ | ✓ |
| leases | ✓ | ✓ |
| transactions | ✓ | ✓ |
| events | ✓ | ✓ |
| documents | ✓ | ✓ |
| bank_accounts | ✓ | ✓ |
| matching_rules | ✓ | ✓ |
| settlements | ✓ | ✓ |
| sync_logs | ✓ | — |
| transaction_audit_logs | ✓ | — |

Scope enforcement happens at resolver level. Missing scope → GraphQL `FORBIDDEN` error (not HTTP 403). Partial success is allowed — a single request can succeed on some fields and return errors on others.

## API Style

GraphQL (Apollo Server 4) at `POST /api/v1/graphql`. Versioned path allows future breaking schema changes without impacting existing keys. The endpoint is API-only (no Sandbox landing page served).

## Database

New `ApiKey` model:

```prisma
model ApiKey {
  id          String    @id @default(uuid())
  userId      String    @map("user_id")
  name        String
  keyHash     String    @unique @map("key_hash")   // SHA-256 hex of raw key
  keyPrefix   String    @map("key_prefix")          // 8 chars after "chk_" prefix, for display
  scopes      String                                // JSON array string (SQLite has no array type)
  expiresAt   DateTime  @map("expires_at")          // mandatory, max 1 year
  revokedAt   DateTime? @map("revoked_at")
  lastUsedAt  DateTime? @map("last_used_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([keyHash])
  @@index([userId])
  @@map("api_keys")
}
```

## Key Management UI

New card section in the existing Settings page (between Bank Accounts and User Management):

- **List**: Table with columns Name, Prefix (monospace), Scopes, Expires, Status, Revoke
- **Create dialog**: Name field, scope checkboxes (grouped by resource, write auto-checks read), date picker (min today, max +1 year)
- **Reveal dialog**: Full key shown once in a copy-to-clipboard field with warning; backdrop close disabled; requires explicit "I've copied it" button
- **Revoke**: ConfirmDialog, immediate effect, no undo

Keys are immutable after creation (scopes and expiry cannot be edited — revoke and recreate to change).

## Architecture

### New server files
- `server/src/middleware/apiKeyAuth.ts` — Express middleware: hash → lookup → validate → `req.apiKey`
- `server/src/graphql/auth.ts` — `assertScope()` helper for resolvers
- `server/src/graphql/schema.ts` — Apollo SDL type definitions
- `server/src/graphql/resolvers/<resource>.resolver.ts` — one file per resource
- `server/src/graphql/resolvers/index.ts` — merged root resolver
- `server/src/graphql/index.ts` — `async initGraphQL(app)` factory
- `server/src/routes/api-keys.ts` — REST CRUD for key management (session auth only)

### Modified server files
- `prisma/schema.prisma` — add ApiKey model
- `server/src/app.ts` — mount api-keys router
- `server/src/server.ts` — call `await initGraphQL(app)` after `createApp()`
- `server/src/types/express.d.ts` — add `req.apiKey` type

### New shared files
- `shared/types/apiKey.types.ts` — ApiKeyScope union, ApiKeyListItem, request/response types
- `shared/validation/apiKey.validation.ts` — Zod schemas

### New client files
- `client/src/services/api/apiKeys.service.ts` — listKeys, createKey, revokeKey
- `client/src/pages/settings/ApiKeysSection.tsx` — Settings section component
- `client/src/pages/settings/ApiKeysSection.module.scss` — styles

### Modified client files
- `client/src/pages/Settings.tsx` — insert ApiKeysSection

## Key Design Decisions

**`createApp()` stays synchronous**: Apollo's `server.start()` is async, but breaking all existing test files is unacceptable. `createApp()` registers all existing routes/middleware synchronously. `initGraphQL(app)` is a separate async function called from `server.ts` only. The GraphQL test file calls `initGraphQL(app)` in `beforeAll` — no other test files change.

**SHA-256 for key hashing**: Bcrypt is overkill for a randomly-generated 32-byte token (no dictionary attacks possible). SHA-256 is fast and sufficient.

**`lastUsedAt` fire-and-forget**: Updated asynchronously on every valid request with `.catch(() => {})` to avoid adding latency. Not critical if it occasionally fails.

**Data scoping**: Resolvers filter by `context.apiKey.userId` using the same ownership relationships as the REST routes (PropertyOwnership for properties, etc.). Cross-user data access is not permitted even with valid scopes.

**No Sandbox**: `ApolloServerPluginLandingPageDisabled()` applied unconditionally. The endpoint is for machine clients only — no browser UI needed.
