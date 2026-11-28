import { z } from 'zod';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

/** A URL that is https, or http only for localhost / 127.0.0.1 (local development). */
export const httpsOrLocalhostUrl = z
  .string()
  .trim()
  .url('Enter a valid URL')
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        if (url.protocol === 'https:') return true;
        return url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname);
      } catch {
        return false;
      }
    },
    { message: 'URL must use https (http is only allowed for localhost)' }
  );

/** Input an admin submits from the Monzo setup wizard. */
export const MonzoSettingsUpdateSchema = z.object({
  clientId: z
    .string()
    .trim()
    .startsWith('oauth2client_', 'Client ID must start with "oauth2client_"'),
  // Blank/absent keeps the existing secret; the server requires it on first save.
  clientSecret: z.string().trim().optional().or(z.literal('')),
  redirectUri: httpsOrLocalhostUrl,
  webhookBaseUrl: httpsOrLocalhostUrl,
});

/** Response for GET/PUT /api/bank/monzo/settings. Never contains any secret. */
export const MonzoSettingsSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string(),
  webhookBaseUrl: z.string(),
  hasClientSecret: z.boolean(),
  configured: z.boolean(),
  source: z.enum(['db', 'env', 'none']),
  suggested: z.object({
    redirectUri: z.string(),
    webhookBaseUrl: z.string(),
  }),
  hasBankAccounts: z.boolean(),
});

export type MonzoSettingsUpdate = z.infer<typeof MonzoSettingsUpdateSchema>;
export type MonzoSettingsResponse = z.infer<typeof MonzoSettingsSchema>;
