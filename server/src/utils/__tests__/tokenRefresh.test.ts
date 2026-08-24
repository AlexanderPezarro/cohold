import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

interface MockMonzoTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  user_id?: string;
}

const mockRefreshAccessToken = jest.fn<
  (refreshToken: string, clientId: string, clientSecret: string) => Promise<MockMonzoTokenResponse>
>();

jest.unstable_mockModule('../../services/monzo/client.js', () => ({
  refreshAccessToken: mockRefreshAccessToken,
  exchangeCodeForTokens: jest.fn(),
}));

// Import after mocking so tokenRefresh.ts picks up the mocked monzo client
const prisma = (await import('../../db/client.js')).default;
const { encryptToken, decryptToken } = await import('../../services/encryption.js');
const { refreshBankAccountToken, isTokenExpired } = await import('../tokenRefresh.js');

function makeAccountId(): string {
  return `acc_token_refresh_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

describe('Token Refresh Utility', () => {
  describe('isTokenExpired', () => {
    it('should return true if token is expired', () => {
      const expiredDate = new Date(Date.now() - 1000); // 1 second ago
      expect(isTokenExpired(expiredDate)).toBe(true);
    });

    it('should return true if token expires within buffer time', () => {
      const almostExpiredDate = new Date(Date.now() + 30000); // 30 seconds from now
      expect(isTokenExpired(almostExpiredDate, 60)).toBe(true); // 60 second buffer
    });

    it('should return false if token is not expired', () => {
      const futureDate = new Date(Date.now() + 120000); // 2 minutes from now
      expect(isTokenExpired(futureDate, 60)).toBe(false); // 60 second buffer
    });

    it('should return false if tokenExpiresAt is null', () => {
      expect(isTokenExpired(null)).toBe(false);
    });

    it('should use default 60 second buffer', () => {
      const date = new Date(Date.now() + 59000); // 59 seconds from now
      expect(isTokenExpired(date)).toBe(true); // Within default 60s buffer

      const date2 = new Date(Date.now() + 61000); // 61 seconds from now
      expect(isTokenExpired(date2)).toBe(false); // Outside default 60s buffer
    });
  });

  describe('refreshBankAccountToken', () => {
    const originalClientId = process.env.MONZO_CLIENT_ID;
    const originalClientSecret = process.env.MONZO_CLIENT_SECRET;
    const createdAccountIds: string[] = [];

    beforeEach(() => {
      jest.clearAllMocks();
      process.env.MONZO_CLIENT_ID = 'test_client_id';
      process.env.MONZO_CLIENT_SECRET = 'test_client_secret';
    });

    afterEach(async () => {
      if (createdAccountIds.length > 0) {
        await prisma.bankAccount.deleteMany({ where: { id: { in: createdAccountIds } } });
        createdAccountIds.length = 0;
      }
      if (originalClientId === undefined) {
        delete process.env.MONZO_CLIENT_ID;
      } else {
        process.env.MONZO_CLIENT_ID = originalClientId;
      }
      if (originalClientSecret === undefined) {
        delete process.env.MONZO_CLIENT_SECRET;
      } else {
        process.env.MONZO_CLIENT_SECRET = originalClientSecret;
      }
    });

    async function createBankAccount(overrides: Record<string, unknown> = {}) {
      const account = await prisma.bankAccount.create({
        data: {
          accountId: makeAccountId(),
          accountName: 'Test Account',
          accountType: 'current',
          provider: 'monzo',
          accessToken: encryptToken('old_access_token'),
          refreshToken: encryptToken('old_refresh_token'),
          syncFromDate: new Date('2024-01-01'),
          syncEnabled: true,
          lastSyncStatus: 'success',
          ...overrides,
        },
      });
      createdAccountIds.push(account.id);
      return account;
    }

    it('throws when the bank account is not found', async () => {
      await expect(refreshBankAccountToken('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        'Bank account not found'
      );
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('throws when the bank account has no refresh token', async () => {
      const bankAccount = await createBankAccount({ refreshToken: null });

      await expect(refreshBankAccountToken(bankAccount.id)).rejects.toThrow(
        'No refresh token available. Please reconnect your bank account.'
      );
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('throws when MONZO_CLIENT_ID/MONZO_CLIENT_SECRET are missing', async () => {
      delete process.env.MONZO_CLIENT_ID;
      delete process.env.MONZO_CLIENT_SECRET;
      const bankAccount = await createBankAccount();

      await expect(refreshBankAccountToken(bankAccount.id)).rejects.toThrow(
        'Monzo OAuth configuration missing'
      );
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('refreshes the token, updates the database, and returns the new access token', async () => {
      const bankAccount = await createBankAccount({
        refreshToken: encryptToken('current_refresh_token'),
      });

      mockRefreshAccessToken.mockResolvedValueOnce({
        access_token: 'new_access_token',
        refresh_token: 'new_refresh_token',
        expires_in: 3600,
        token_type: 'Bearer',
      });

      const result = await refreshBankAccountToken(bankAccount.id);

      expect(result).toBe('new_access_token');
      expect(mockRefreshAccessToken).toHaveBeenCalledWith(
        'current_refresh_token',
        'test_client_id',
        'test_client_secret'
      );

      const updated = await prisma.bankAccount.findUnique({ where: { id: bankAccount.id } });
      expect(updated).toBeTruthy();
      expect(decryptToken(updated!.accessToken)).toBe('new_access_token');
      expect(decryptToken(updated!.refreshToken!)).toBe('new_refresh_token');
      expect(updated!.tokenExpiresAt).toBeTruthy();
      expect(updated!.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('keeps the existing refresh token when the provider does not return a new one', async () => {
      const bankAccount = await createBankAccount({
        refreshToken: encryptToken('stable_refresh_token'),
      });

      mockRefreshAccessToken.mockResolvedValueOnce({
        access_token: 'another_new_access_token',
        expires_in: 3600,
        token_type: 'Bearer',
      });

      await refreshBankAccountToken(bankAccount.id);

      const updated = await prisma.bankAccount.findUnique({ where: { id: bankAccount.id } });
      expect(decryptToken(updated!.accessToken)).toBe('another_new_access_token');
      expect(decryptToken(updated!.refreshToken!)).toBe('stable_refresh_token');
    });
  });
});
