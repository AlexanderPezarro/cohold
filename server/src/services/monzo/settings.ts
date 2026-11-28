/**
 * Monzo OAuth client settings.
 *
 * The instance admin enters their Monzo OAuth client in the in-app wizard and it
 * is stored in the singleton `MonzoSettings` row (client secret encrypted).
 * The `MONZO_*` / `WEBHOOK_BASE_URL` environment variables remain as a fallback.
 *
 * Resolution is per row, not per field: if a DB row exists, every value comes
 * from it and the environment is ignored, so a client ID from one source is
 * never paired with a secret from another.
 */

import { randomUUID } from 'crypto';
import prisma from '../../db/client.js';
import { decryptToken, encryptToken } from '../encryption.js';

const SINGLETON_ID = 'singleton';

/** Thrown when no Monzo OAuth client is configured (DB or env). */
export class MonzoNotConfiguredError extends Error {
  constructor() {
    super('Monzo is not configured');
    this.name = 'MonzoNotConfiguredError';
  }
}

/** Thrown when the first save does not include a client secret. */
export class MonzoClientSecretRequiredError extends Error {
  constructor() {
    super('A client secret is required the first time Monzo settings are saved');
    this.name = 'MonzoClientSecretRequiredError';
  }
}

export interface ResolvedMonzoSettings {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  webhookBaseUrl?: string;
  webhookSecret?: string;
  source: 'db' | 'env' | 'none';
}

export interface MonzoSettingsInput {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  webhookBaseUrl: string;
}

export function getStoredMonzoSettings() {
  return prisma.monzoSettings.findUnique({ where: { id: SINGLETON_ID } });
}

/** Resolve the effective settings: the DB row if present, otherwise the environment. */
export async function resolveMonzoSettings(): Promise<ResolvedMonzoSettings> {
  const row = await getStoredMonzoSettings();

  if (row) {
    return {
      clientId: row.clientId,
      clientSecret: decryptToken(row.clientSecretEncrypted),
      redirectUri: row.redirectUri,
      webhookBaseUrl: row.webhookBaseUrl,
      webhookSecret: row.webhookSecret,
      source: 'db',
    };
  }

  const clientId = process.env.MONZO_CLIENT_ID || undefined;
  const clientSecret = process.env.MONZO_CLIENT_SECRET || undefined;
  const redirectUri = process.env.MONZO_REDIRECT_URI || undefined;
  const webhookBaseUrl = process.env.WEBHOOK_BASE_URL || undefined;
  const webhookSecret = process.env.MONZO_WEBHOOK_SECRET || undefined;

  const anyEnv = clientId || clientSecret || redirectUri || webhookBaseUrl || webhookSecret;

  return {
    clientId,
    clientSecret,
    redirectUri,
    webhookBaseUrl,
    webhookSecret,
    source: anyEnv ? 'env' : 'none',
  };
}

export function isMonzoConfigured(settings: ResolvedMonzoSettings): boolean {
  return Boolean(settings.clientId && settings.clientSecret && settings.redirectUri);
}

/**
 * Create or update the singleton row. A blank/absent secret keeps the stored
 * one; the webhook secret is generated once and never changed.
 */
export async function saveMonzoSettings(input: MonzoSettingsInput) {
  const existing = await getStoredMonzoSettings();
  const newSecret = input.clientSecret?.trim();

  if (!existing && !newSecret) {
    throw new MonzoClientSecretRequiredError();
  }

  const common = {
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    webhookBaseUrl: input.webhookBaseUrl,
  };

  if (!existing) {
    return prisma.monzoSettings.create({
      data: {
        id: SINGLETON_ID,
        ...common,
        clientSecretEncrypted: encryptToken(newSecret!),
        webhookSecret: randomUUID(),
      },
    });
  }

  return prisma.monzoSettings.update({
    where: { id: SINGLETON_ID },
    data: {
      ...common,
      ...(newSecret ? { clientSecretEncrypted: encryptToken(newSecret) } : {}),
    },
  });
}

/** URLs prefilled in the wizard, derived from CLIENT_URL (the public origin). */
export function getSuggestedUrls(): { redirectUri: string; webhookBaseUrl: string } {
  const base = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
  return {
    redirectUri: `${base}/api/bank/monzo/callback`,
    webhookBaseUrl: base,
  };
}
