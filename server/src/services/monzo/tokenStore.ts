/**
 * Wiring between cohold's persistence and the `monzo-core` library.
 *
 * `monzo-core` owns the Monzo HTTP API, retry/backoff, pagination and the
 * OAuth token lifecycle. Everything cohold-specific — reading the OAuth
 * config from the environment, encrypting/decrypting tokens, and where a
 * token lives (one per `bankAccount` row) — stays here, expressed as a
 * `TokenStore` and a `MonzoConfig` factory.
 */

import { MonzoClient, type MonzoConfig, type StoredToken, type TokenStore } from 'monzo-core';
import prisma from '../../db/client.js';
import { decryptToken, encryptToken } from '../encryption.js';

/**
 * Builds a `MonzoConfig` from the environment.
 *
 * `fetch` is passed as a thin wrapper around the live `globalThis.fetch` so
 * that a test which reassigns `global.fetch` after this call still has its
 * mock used by the client.
 */
export function getMonzoConfig(): MonzoConfig {
  const clientId = process.env.MONZO_CLIENT_ID;
  const clientSecret = process.env.MONZO_CLIENT_SECRET;
  const redirectUri = process.env.MONZO_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Monzo OAuth configuration missing');
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    fetch: ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      globalThis.fetch(input, init)) as typeof fetch,
  };
}

/**
 * A `TokenStore` backed by the encrypted `accessToken` / `refreshToken` /
 * `tokenExpiresAt` columns on a single `bankAccount` row. One store — and one
 * `MonzoClient` — per connected account.
 *
 * `markInvalid` flags the account as needing re-authorisation by setting
 * `lastSyncStatus` to `auth_failed`; the manual-sync route already surfaces
 * that to the user as a 401 "reconnect" response.
 */
export function makeBankAccountTokenStore(bankAccountId: string): TokenStore {
  return {
    async get(): Promise<StoredToken | null> {
      const row = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
      if (!row) return null;
      return {
        accessToken: decryptToken(row.accessToken),
        refreshToken: row.refreshToken ? decryptToken(row.refreshToken) : '',
        // A row with no recorded expiry is treated as "does not expire" (as
        // the old `isTokenExpired(null)` did) — proactive refresh is skipped
        // and a stale token is still recovered reactively on a 401.
        expiresAt: row.tokenExpiresAt ? row.tokenExpiresAt.getTime() : Number.MAX_SAFE_INTEGER,
      };
    },
    async save(token: StoredToken): Promise<void> {
      await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: {
          accessToken: encryptToken(token.accessToken),
          refreshToken: token.refreshToken ? encryptToken(token.refreshToken) : null,
          tokenExpiresAt: new Date(token.expiresAt),
        },
      });
    },
    async markInvalid(): Promise<void> {
      await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: { lastSyncStatus: 'auth_failed' },
      });
    },
  };
}

/**
 * An in-memory `TokenStore` for the window between the OAuth code exchange
 * and the `bankAccount` row being created (Monzo's Strong Customer
 * Authentication step). Holds the freshly issued token; a refresh during
 * this short-lived phase is kept in memory only.
 */
export function staticTokenStore(token: StoredToken): TokenStore {
  let current = token;
  return {
    async get(): Promise<StoredToken> {
      return current;
    },
    async save(next: StoredToken): Promise<void> {
      current = next;
    },
  };
}

/** A `MonzoClient` bound to a connected account's persisted token. */
export function getMonzoClient(bankAccountId: string): MonzoClient {
  return new MonzoClient(getMonzoConfig(), makeBankAccountTokenStore(bankAccountId));
}

/**
 * A `MonzoClient` for the SCA-pending phase, bound to an in-memory token
 * that has not been persisted yet.
 */
export function getPendingMonzoClient(
  accessToken: string,
  refreshToken: string | undefined,
  expiresIn: number
): MonzoClient {
  return new MonzoClient(
    getMonzoConfig(),
    staticTokenStore({
      accessToken,
      refreshToken: refreshToken ?? '',
      expiresAt: Date.now() + expiresIn * 1000,
    })
  );
}
