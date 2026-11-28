/**
 * Wiring between cohold's persistence and the `monzo-core` library.
 *
 * `monzo-core` owns the Monzo HTTP API, retry/backoff, pagination and the
 * OAuth token lifecycle. Everything cohold-specific — resolving the OAuth
 * config (in-app settings, else environment), encrypting/decrypting tokens, and where a
 * token lives (one per `bankAccount` row) — stays here, expressed as a
 * `TokenStore` and a `MonzoConfig` factory.
 */

import { MonzoClient, type MonzoConfig, type StoredToken, type TokenStore } from 'monzo-core';
import prisma from '../../db/client.js';
import { decryptToken, encryptToken } from '../encryption.js';
import { isMonzoConfigured, MonzoNotConfiguredError, resolveMonzoSettings } from './settings.js';

export { MonzoNotConfiguredError };

/**
 * Builds a `MonzoConfig` from the in-app settings (DB row) or, failing that,
 * the environment. Throws `MonzoNotConfiguredError` when neither is set.
 *
 * `fetch` is passed as a thin wrapper around the live `globalThis.fetch` so
 * that a test which reassigns `global.fetch` after this call still has its
 * mock used by the client.
 */
export async function getMonzoConfig(): Promise<MonzoConfig> {
  const settings = await resolveMonzoSettings();

  if (!isMonzoConfigured(settings)) {
    throw new MonzoNotConfiguredError();
  }

  // isMonzoConfigured guarantees these are non-empty strings.
  const clientId = settings.clientId!;
  const clientSecret = settings.clientSecret!;
  const redirectUri = settings.redirectUri!;

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
export async function getMonzoClient(bankAccountId: string): Promise<MonzoClient> {
  return new MonzoClient(await getMonzoConfig(), makeBankAccountTokenStore(bankAccountId));
}

/**
 * A `MonzoClient` for the SCA-pending phase, bound to an in-memory token
 * that has not been persisted yet.
 */
export async function getPendingMonzoClient(
  accessToken: string,
  refreshToken: string | undefined,
  expiresIn: number
): Promise<MonzoClient> {
  return new MonzoClient(
    await getMonzoConfig(),
    staticTokenStore({
      accessToken,
      refreshToken: refreshToken ?? '',
      expiresAt: Date.now() + expiresIn * 1000,
    })
  );
}
