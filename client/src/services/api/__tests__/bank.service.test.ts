import { bankService, WebhookStatusData, BankAccount, SyncLog, ImportProgressUpdate } from '../bank.service';
import { api } from '../../api';

jest.mock('../../api');
const mockedApi = api as jest.Mocked<typeof api>;

describe('bankService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getBankAccounts', () => {
    it('should fetch and return the list of bank accounts', async () => {
      const mockAccounts: BankAccount[] = [
        {
          id: 'ba-1',
          accountId: 'acc-1',
          accountName: 'Current Account',
          accountType: 'current',
          provider: 'monzo',
          syncEnabled: true,
          syncFromDate: '2024-01-01T00:00:00Z',
          lastSyncAt: '2024-01-02T00:00:00Z',
          lastSyncStatus: 'success',
          webhookId: 'wh-1',
          webhookUrl: 'https://example.com/webhook',
          pendingCount: 2,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      ];

      mockedApi.get.mockResolvedValue({
        data: { success: true, accounts: mockAccounts },
      } as any);

      const result = await bankService.getBankAccounts();

      expect(mockedApi.get).toHaveBeenCalledWith('/bank/accounts');
      expect(result).toEqual(mockAccounts);
    });

    it('should propagate errors when fetching bank accounts fails', async () => {
      mockedApi.get.mockRejectedValue(new Error('network down'));

      await expect(bankService.getBankAccounts()).rejects.toThrow('network down');
    });
  });

  describe('connectMonzo', () => {
    it('should initiate the Monzo OAuth flow with a custom sync window', async () => {
      mockedApi.post.mockResolvedValue({
        data: { success: true, authUrl: 'https://auth.monzo.com/authorize' },
      } as any);

      const result = await bankService.connectMonzo(30);

      expect(mockedApi.post).toHaveBeenCalledWith('/bank/monzo/connect', { syncFromDays: 30 });
      expect(result).toEqual({ success: true, authUrl: 'https://auth.monzo.com/authorize' });
    });

    it('should initiate the Monzo OAuth flow without specifying a sync window', async () => {
      mockedApi.post.mockResolvedValue({
        data: { success: true, authUrl: 'https://auth.monzo.com/authorize' },
      } as any);

      await bankService.connectMonzo();

      expect(mockedApi.post).toHaveBeenCalledWith('/bank/monzo/connect', { syncFromDays: undefined });
    });
  });

  describe('getActiveSyncLog', () => {
    it('should fetch the active sync log for a bank account', async () => {
      const mockSyncLog: SyncLog = {
        id: 'sync-1',
        status: 'in_progress',
        syncType: 'manual',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: null,
        transactionsFetched: 10,
        transactionsSkipped: 1,
        errorMessage: null,
      };

      mockedApi.get.mockResolvedValue({
        data: { success: true, syncLog: mockSyncLog },
      } as any);

      const result = await bankService.getActiveSyncLog('ba-1');

      expect(mockedApi.get).toHaveBeenCalledWith('/bank/accounts/ba-1/active-sync');
      expect(result).toEqual(mockSyncLog);
    });

    it('should propagate errors when there is no active sync', async () => {
      mockedApi.get.mockRejectedValue(new Error('no active sync'));

      await expect(bankService.getActiveSyncLog('ba-1')).rejects.toThrow('no active sync');
    });
  });

  describe('completeMonzoConnection', () => {
    it('should complete the Monzo connection with a pending ID', async () => {
      mockedApi.post.mockResolvedValue({
        data: { success: true, bankAccountId: 'ba-1' },
      } as any);

      const result = await bankService.completeMonzoConnection('pending-123');

      expect(mockedApi.post).toHaveBeenCalledWith('/bank/monzo/complete-connection', {
        pendingId: 'pending-123',
      });
      expect(result).toEqual({ success: true, bankAccountId: 'ba-1' });
    });

    it('should propagate errors when completing the connection fails', async () => {
      mockedApi.post.mockRejectedValue(new Error('sca not approved'));

      await expect(bankService.completeMonzoConnection('pending-123')).rejects.toThrow(
        'sca not approved'
      );
    });
  });

  describe('subscribeToImportProgress', () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      url: string;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      closed = false;

      constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
      }

      close() {
        this.closed = true;
      }
    }

    let originalEventSource: any;

    beforeEach(() => {
      MockEventSource.instances = [];
      originalEventSource = (global as any).EventSource;
      (global as any).EventSource = MockEventSource as any;
    });

    afterEach(() => {
      (global as any).EventSource = originalEventSource;
    });

    it('should open an EventSource against the correct URL', () => {
      const onProgress = jest.fn();

      bankService.subscribeToImportProgress('sync-1', onProgress);

      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.instances[0].url).toBe('/api/bank/monzo/import-progress/sync-1');
    });

    it('should invoke onProgress with parsed update data', () => {
      const onProgress = jest.fn();
      bankService.subscribeToImportProgress('sync-1', onProgress);

      const update: ImportProgressUpdate = {
        syncLogId: 'sync-1',
        status: 'processing',
        transactionsFetched: 5,
        transactionsProcessed: 3,
        duplicatesSkipped: 1,
      };

      const source = MockEventSource.instances[0];
      source.onmessage?.({ data: JSON.stringify(update) } as MessageEvent);

      expect(onProgress).toHaveBeenCalledWith(update);
    });

    it('should log and swallow errors when the update payload is not valid JSON', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const onProgress = jest.fn();
      bankService.subscribeToImportProgress('sync-1', onProgress);

      const source = MockEventSource.instances[0];
      expect(() => {
        source.onmessage?.({ data: 'not-json' } as MessageEvent);
      }).not.toThrow();

      expect(onProgress).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Error parsing progress update:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('should close the connection and log on SSE connection error', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const onProgress = jest.fn();
      bankService.subscribeToImportProgress('sync-1', onProgress);

      const source = MockEventSource.instances[0];
      const errorEvent = new Event('error');
      source.onerror?.(errorEvent);

      expect(consoleSpy).toHaveBeenCalledWith('SSE connection error:', errorEvent);
      expect(source.closed).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should return a cleanup function that closes the EventSource', () => {
      const onProgress = jest.fn();
      const cleanup = bankService.subscribeToImportProgress('sync-1', onProgress);

      const source = MockEventSource.instances[0];
      expect(source.closed).toBe(false);

      cleanup();

      expect(source.closed).toBe(true);
    });
  });

  describe('getWebhookStatus', () => {
    it('should fetch webhook status data', async () => {
      const mockWebhookStatus: WebhookStatusData = {
        lastEventTimestamp: '2024-01-24T10:00:00Z',
        recentEvents: [
          {
            id: '1',
            accountId: 'acc-1',
            accountName: 'Test Account',
            status: 'success',
            startedAt: '2024-01-24T10:00:00Z',
            completedAt: '2024-01-24T10:00:01Z',
            errorMessage: null,
            webhookEventId: 'evt_123',
            transactionsFetched: 1,
          },
        ],
        failedCount24h: 0,
        failedCount1h: 0,
        accountStatuses: [
          {
            accountId: 'acc-1',
            accountName: 'Test Account',
            lastWebhookAt: '2024-01-24T10:00:00Z',
            lastWebhookStatus: 'success',
            webhookId: 'webhook_123',
          },
        ],
      };

      mockedApi.get.mockResolvedValue({
        data: { success: true, data: mockWebhookStatus },
      } as any);

      const result = await bankService.getWebhookStatus();

      expect(mockedApi.get).toHaveBeenCalledWith('/bank/webhooks/status');
      expect(result).toEqual(mockWebhookStatus);
    });

    it('should handle errors when fetching webhook status', async () => {
      const mockError = new Error('Failed to fetch webhook status');
      mockedApi.get.mockRejectedValue(mockError);

      await expect(bankService.getWebhookStatus()).rejects.toThrow('Failed to fetch webhook status');
    });

    it('should return data with no events when none exist', async () => {
      const mockEmptyStatus: WebhookStatusData = {
        lastEventTimestamp: null,
        recentEvents: [],
        failedCount24h: 0,
        failedCount1h: 0,
        accountStatuses: [],
      };

      mockedApi.get.mockResolvedValue({
        data: { success: true, data: mockEmptyStatus },
      } as any);

      const result = await bankService.getWebhookStatus();

      expect(result.lastEventTimestamp).toBeNull();
      expect(result.recentEvents).toHaveLength(0);
      expect(result.failedCount24h).toBe(0);
      expect(result.failedCount1h).toBe(0);
    });

    it('should return failure counts when webhooks have failed', async () => {
      const mockFailedStatus: WebhookStatusData = {
        lastEventTimestamp: '2024-01-24T10:00:00Z',
        recentEvents: [],
        failedCount24h: 5,
        failedCount1h: 3,
        accountStatuses: [],
      };

      mockedApi.get.mockResolvedValue({
        data: { success: true, data: mockFailedStatus },
      } as any);

      const result = await bankService.getWebhookStatus();

      expect(result.failedCount24h).toBe(5);
      expect(result.failedCount1h).toBe(3);
    });
  });
});
