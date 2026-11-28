import { describe, it, expect } from '@jest/globals';
import { MonzoSettingsUpdateSchema } from '../monzoSettings.validation';

const valid = {
  clientId: 'oauth2client_test123',
  clientSecret: 'mock-secret-value',
  redirectUri: 'https://app.example.com/api/bank/monzo/callback',
  webhookBaseUrl: 'https://app.example.com',
};

describe('MonzoSettingsUpdateSchema', () => {
  it('accepts valid https input', () => {
    expect(MonzoSettingsUpdateSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a client ID without the oauth2client_ prefix', () => {
    const result = MonzoSettingsUpdateSchema.safeParse({ ...valid, clientId: 'abc123' });
    expect(result.success).toBe(false);
  });

  it('accepts http://localhost', () => {
    const result = MonzoSettingsUpdateSchema.safeParse({
      ...valid,
      redirectUri: 'http://localhost:3000/api/bank/monzo/callback',
      webhookBaseUrl: 'http://127.0.0.1:3000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects plain http on another host', () => {
    expect(
      MonzoSettingsUpdateSchema.safeParse({ ...valid, redirectUri: 'http://example.com/cb' }).success
    ).toBe(false);
    expect(
      MonzoSettingsUpdateSchema.safeParse({ ...valid, webhookBaseUrl: 'http://example.com' }).success
    ).toBe(false);
  });

  it('rejects a non-URL value', () => {
    expect(MonzoSettingsUpdateSchema.safeParse({ ...valid, redirectUri: 'nope' }).success).toBe(false);
  });

  it('allows a blank or absent client secret', () => {
    expect(MonzoSettingsUpdateSchema.safeParse({ ...valid, clientSecret: '' }).success).toBe(true);
    const { clientSecret: _omit, ...withoutSecret } = valid;
    expect(MonzoSettingsUpdateSchema.safeParse(withoutSecret).success).toBe(true);
  });
});
