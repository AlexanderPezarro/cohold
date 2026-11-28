import { describe, it, expect, beforeEach, afterEach, afterAll } from '@jest/globals';
import prisma from '../../db/client.js';
import { decryptToken } from '../encryption.js';
import {
  MonzoClientSecretRequiredError,
  MonzoNotConfiguredError,
  getSuggestedUrls,
  isMonzoConfigured,
  resolveMonzoSettings,
  saveMonzoSettings,
} from '../monzo/settings.js';
import { getMonzoConfig } from '../monzo/tokenStore.js';

const ENV_KEYS = [
  'MONZO_CLIENT_ID',
  'MONZO_CLIENT_SECRET',
  'MONZO_REDIRECT_URI',
  'WEBHOOK_BASE_URL',
  'MONZO_WEBHOOK_SECRET',
  'CLIENT_URL',
] as const;

describe('Monzo settings service', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    await prisma.monzoSettings.deleteMany({});
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await prisma.monzoSettings.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const input = {
    clientId: 'oauth2client_db',
    clientSecret: 'mock-db-secret',
    redirectUri: 'https://cohold.example.test/api/bank/monzo/callback',
    webhookBaseUrl: 'https://cohold.example.test',
  };

  function setEnv() {
    process.env.MONZO_CLIENT_ID = 'oauth2client_env';
    process.env.MONZO_CLIENT_SECRET = 'mock-env-secret';
    process.env.MONZO_REDIRECT_URI = 'http://localhost:3000/api/bank/monzo/callback';
    process.env.WEBHOOK_BASE_URL = 'http://localhost:3000';
    process.env.MONZO_WEBHOOK_SECRET = 'env-webhook-secret';
  }

  it('reports not configured with no row and no env', async () => {
    const resolved = await resolveMonzoSettings();
    expect(resolved.source).toBe('none');
    expect(isMonzoConfigured(resolved)).toBe(false);
  });

  it('falls back to env vars when there is no row', async () => {
    setEnv();
    const resolved = await resolveMonzoSettings();
    expect(resolved.source).toBe('env');
    expect(resolved.clientId).toBe('oauth2client_env');
    expect(resolved.clientSecret).toBe('mock-env-secret');
    expect(resolved.webhookSecret).toBe('env-webhook-secret');
    expect(isMonzoConfigured(resolved)).toBe(true);
  });

  it('prefers the DB row over env, without mixing fields', async () => {
    setEnv();
    await saveMonzoSettings(input);
    const resolved = await resolveMonzoSettings();
    expect(resolved.source).toBe('db');
    expect(resolved.clientId).toBe('oauth2client_db');
    expect(resolved.clientSecret).toBe('mock-db-secret');
    expect(resolved.redirectUri).toBe(input.redirectUri);
    expect(resolved.webhookBaseUrl).toBe(input.webhookBaseUrl);
    expect(resolved.webhookSecret).not.toBe('env-webhook-secret');
  });

  it('requires a secret on first save', async () => {
    await expect(saveMonzoSettings({ ...input, clientSecret: '' })).rejects.toBeInstanceOf(
      MonzoClientSecretRequiredError
    );
  });

  it('encrypts the secret and generates the webhook secret once', async () => {
    const first = await saveMonzoSettings(input);
    expect(first.clientSecretEncrypted).not.toBe('mock-db-secret');
    expect(decryptToken(first.clientSecretEncrypted)).toBe('mock-db-secret');
    expect(first.webhookSecret).toMatch(/^[0-9a-f-]{36}$/);

    const second = await saveMonzoSettings({
      ...input,
      clientId: 'oauth2client_changed',
      clientSecret: '',
    });
    expect(second.clientId).toBe('oauth2client_changed');
    expect(second.clientSecretEncrypted).toBe(first.clientSecretEncrypted);
    expect(second.webhookSecret).toBe(first.webhookSecret);

    const third = await saveMonzoSettings({ ...input, clientSecret: 'mock-new-secret' });
    expect(decryptToken(third.clientSecretEncrypted)).toBe('mock-new-secret');
  });

  it('getMonzoConfig resolves from the DB', async () => {
    await saveMonzoSettings(input);
    const config = await getMonzoConfig();
    expect(config.clientId).toBe('oauth2client_db');
    expect(config.clientSecret).toBe('mock-db-secret');
    expect(config.redirectUri).toBe(input.redirectUri);
  });

  it('getMonzoConfig throws MonzoNotConfiguredError when nothing is configured', async () => {
    await expect(getMonzoConfig()).rejects.toBeInstanceOf(MonzoNotConfiguredError);
  });

  it('builds suggested URLs from CLIENT_URL, defaulting to the Vite origin', () => {
    expect(getSuggestedUrls()).toEqual({
      redirectUri: 'http://localhost:5173/api/bank/monzo/callback',
      webhookBaseUrl: 'http://localhost:5173',
    });
    process.env.CLIENT_URL = 'https://cohold.example.test/';
    expect(getSuggestedUrls()).toEqual({
      redirectUri: 'https://cohold.example.test/api/bank/monzo/callback',
      webhookBaseUrl: 'https://cohold.example.test',
    });
  });
});
