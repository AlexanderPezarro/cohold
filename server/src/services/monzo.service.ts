import crypto from 'crypto';
import {
  buildAuthUrl,
  exchangeCode,
  getUserMessage,
  type MonzoTransaction,
  type MonzoTransactionsResponse,
} from 'monzo-core';
import prisma from '../db/client.js';
import { processTransactions } from './transactionProcessor.js';
import { importProgressTracker } from './importProgressTracker.js';
import {
  getMonzoClient,
  getMonzoConfig,
  getPendingMonzoClient,
} from './monzo/tokenStore.js';

// Re-export types for backwards compatibility
export type { MonzoTransaction, MonzoTransactionsResponse };

// In-memory state storage (in production, use Redis or database)
// Maps state -> { syncFromDate: Date, createdAt: Date }
const stateStore = new Map<string, { syncFromDate: Date; createdAt: Date }>();

// Clean up expired states every 10 minutes
setInterval(() => {
  const now = Date.now();
  const expiryMs = 10 * 60 * 1000; // 10 minutes

  for (const [state, data] of stateStore.entries()) {
    if (now - data.createdAt.getTime() > expiryMs) {
      stateStore.delete(state);
    }
  }
}, 10 * 60 * 1000);

// Pending connections awaiting SCA approval in the Monzo app.
// After OAuth token exchange, Monzo requires the user to approve access in their app
// before API calls will work. Tokens are stored here until the user confirms approval.
export interface PendingConnection {
  accessToken: string;
  refreshToken: string | undefined;
  expiresIn: number;
  syncFromDate: Date;
}

const pendingConnectionStore = new Map<string, PendingConnection>();

export function storePendingConnection(
  accessToken: string,
  refreshToken: string | undefined,
  expiresIn: number,
  syncFromDate: Date
): string {
  const pendingId = crypto.randomBytes(32).toString('hex');
  pendingConnectionStore.set(pendingId, {
    accessToken,
    refreshToken,
    expiresIn,
    syncFromDate,
  });
  return pendingId;
}

export function getPendingConnection(pendingId: string): PendingConnection {
  const pending = pendingConnectionStore.get(pendingId);
  if (!pending) {
    throw new Error('Pending connection not found or expired');
  }
  return pending;
}

export function deletePendingConnection(pendingId: string): void {
  pendingConnectionStore.delete(pendingId);
}

/**
 * Generates the Monzo OAuth authorization URL
 * @param syncFromDays - Number of days to sync transaction history from
 * @returns Authorization URL to redirect user to
 * @throws MonzoNotConfiguredError if no OAuth client is configured
 */
export async function generateAuthUrl(syncFromDays: number): Promise<string> {
  // Throws if the OAuth configuration is missing.
  const config = await getMonzoConfig();

  // Calculate syncFromDate
  const syncFromDate = new Date();
  syncFromDate.setDate(syncFromDate.getDate() - syncFromDays);

  // Generate secure random state for CSRF protection. `monzo-core` never
  // generates or verifies `state` — that stays here.
  const state = crypto.randomBytes(32).toString('hex');

  // Store state with syncFromDate for later validation
  stateStore.set(state, {
    syncFromDate,
    createdAt: new Date(),
  });

  return buildAuthUrl(config, { state });
}

/**
 * Validates the OAuth state parameter and returns associated data
 * @param state - State parameter from OAuth callback
 * @returns syncFromDate associated with the state
 * @throws Error if state is invalid or expired
 */
export function validateState(state: string): Date {
  const stateData = stateStore.get(state);

  if (!stateData) {
    throw new Error('Invalid or expired state parameter');
  }

  // Check if state has expired (10 minutes)
  const now = Date.now();
  const expiryMs = 10 * 60 * 1000;

  if (now - stateData.createdAt.getTime() > expiryMs) {
    stateStore.delete(state);
    throw new Error('State parameter has expired');
  }

  // Delete state after successful validation (one-time use)
  stateStore.delete(state);

  return stateData.syncFromDate;
}

/**
 * Exchange authorization code for access tokens
 * @param code - Authorization code from OAuth callback
 * @returns Token response with access_token, refresh_token, and expires_in
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const config = await getMonzoConfig();
  const token = await exchangeCode(config, code);

  return {
    access_token: token.accessToken,
    refresh_token: token.refreshToken || undefined,
    expires_in: Math.max(0, Math.round((token.expiresAt - Date.now()) / 1000)),
  };
}

/**
 * Get account information from Monzo API
 * @param accessToken - Monzo access token
 * @returns Account information (accountId, accountName, accountType)
 */
export async function getAccountInfo(accessToken: string): Promise<{
  accountId: string;
  accountName: string;
  accountType: string;
}> {
  // SCA-pending phase: no `bankAccount` row yet, so wrap the freshly issued
  // token in an in-memory store.
  const client = await getPendingMonzoClient(accessToken, undefined, 3600);
  const accounts = await client.listAccounts();

  if (accounts.length === 0) {
    throw new Error('No accounts found');
  }

  // Use first account (or primary if multiple)
  const account = accounts[0];

  return {
    accountId: account.id,
    accountName: account.displayName,
    accountType: account.raw.type || account.type || 'current',
  };
}

/**
 * Import full transaction history from Monzo API
 * This function runs asynchronously in the background and must complete within 5 minutes
 * of OAuth completion (Monzo API restriction).
 *
 * @param bankAccountId - Database ID of the bank account to import transactions for
 * @returns The sync log ID for tracking progress
 */
export async function importFullHistory(bankAccountId: string): Promise<string> {
  let syncLogId: string | undefined;
  let transactionsFetched = 0;
  let duplicatesSkipped = 0;
  const TIMEOUT_MS = 270000; // 4 minutes 30 seconds (safety buffer for 5-minute window)

  try {
    // Get bank account
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
    });

    if (!bankAccount) {
      throw new Error('Bank account not found');
    }

    // Create sync log
    const syncLog = await prisma.syncLog.create({
      data: {
        bankAccountId,
        syncType: 'initial',
        status: 'in_progress',
      },
    });
    syncLogId = syncLog.id;
    // Stable non-nullable alias: the `onPage` closure below captures
    // `syncLogId`, which widens its narrowed type back to `string | undefined`.
    const progressId = syncLog.id;

    // Emit initial progress
    importProgressTracker.emitProgress({
      syncLogId: progressId,
      status: 'fetching',
      transactionsFetched: 0,
      transactionsProcessed: 0,
      duplicatesSkipped: 0,
      message: 'Starting import...',
    });

    // Abort the fetch as the 5-minute Monzo window closes; `fetchAllTransactions`
    // returns whatever it has fetched so far rather than throwing.
    const abortController = new AbortController();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
      console.warn(`Import timeout approaching for bank account ${bankAccountId}, stopping gracefully`);
    }, TIMEOUT_MS);

    let batchNumber = 0;
    let allTransactions: MonzoTransaction[];
    try {
      // Token refresh, retry/backoff and pagination are handled by `monzo-core`.
      allTransactions = await (await getMonzoClient(bankAccountId)).fetchAllTransactions({
        accountId: bankAccount.accountId,
        since: bankAccount.syncFromDate,
        signal: abortController.signal,
        onPage: ({ fetched }) => {
          transactionsFetched = fetched;
          batchNumber++;
          importProgressTracker.emitProgress({
            syncLogId: progressId,
            status: 'fetching',
            transactionsFetched,
            transactionsProcessed: 0,
            duplicatesSkipped: 0,
            currentBatch: batchNumber,
            message: `Fetched ${transactionsFetched} transactions...`,
          });
        },
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    // Emit progress update before processing
    importProgressTracker.emitProgress({
      syncLogId: progressId,
      status: 'processing',
      transactionsFetched,
      transactionsProcessed: 0,
      duplicatesSkipped: 0,
      message: 'Processing transactions...',
    });

    // Process transactions through unified pipeline
    let processedCount = 0;
    if (allTransactions.length > 0) {
      const processResult = await processTransactions(allTransactions, bankAccountId);
      processedCount = processResult.processed;
      duplicatesSkipped = processResult.duplicatesSkipped;

      // Log any processing errors
      if (processResult.errors.length > 0) {
        console.error(`Import encountered ${processResult.errors.length} errors:`, processResult.errors);
      }
    }

    // Determine final status
    const finalStatus = timedOut ? 'partial' : 'success';

    // Update sync log
    await prisma.syncLog.update({
      where: { id: progressId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        transactionsFetched,
        transactionsSkipped: duplicatesSkipped,
      },
    });

    // Update bank account
    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: finalStatus,
      },
    });

    // Emit completion progress
    importProgressTracker.emitProgress({
      syncLogId: progressId,
      status: 'completed',
      transactionsFetched,
      transactionsProcessed: processedCount,
      duplicatesSkipped,
      message: `Import completed: ${processedCount} transactions processed`,
    });

    console.log(`Import completed for bank account ${bankAccountId}: ${transactionsFetched} transactions fetched (${processedCount} processed, ${duplicatesSkipped} duplicates skipped), status: ${finalStatus}`);

    return progressId;
  } catch (error) {
    console.error(`Import failed for bank account ${bankAccountId}:`, error);

    // Update sync log with error
    if (syncLogId) {
      await prisma.syncLog.update({
        where: { id: syncLogId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          transactionsFetched,
          transactionsSkipped: duplicatesSkipped,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          errorDetails: error instanceof Error ? error.stack : undefined,
        },
      });

      // Emit error progress
      importProgressTracker.emitProgress({
        syncLogId,
        status: 'failed',
        transactionsFetched,
        transactionsProcessed: 0,
        duplicatesSkipped,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Update bank account status
    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        lastSyncAt: transactionsFetched > 0 ? new Date() : undefined,
        lastSyncStatus: 'failed',
      },
    });

    throw error;
  }
}

/**
 * Sync result interface returned by syncNewTransactions
 */
export interface SyncResult {
  success: boolean;
  transactionsFetched?: number;
  lastSyncAt?: Date;
  lastSyncStatus?: string;
  error?: string;
}

/**
 * Webhook registration result
 */
export interface WebhookRegistrationResult {
  webhookId: string;
  webhookUrl: string;
}

/**
 * Sync new transactions from Monzo API since last sync
 * This is a synchronous operation with a 30-second timeout for manual sync triggers
 *
 * @param bankAccountId - Database ID of the bank account to sync transactions for
 * @returns SyncResult with status, counts, and timestamps
 */
export async function syncNewTransactions(bankAccountId: string): Promise<SyncResult> {
  let syncLogId: string | undefined;
  let transactionsFetched = 0;
  let duplicatesSkipped = 0;
  const TIMEOUT_MS = 30000; // 30 seconds for manual sync

  try {
    // Get bank account
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
    });

    if (!bankAccount) {
      return {
        success: false,
        error: 'Bank account not found',
      };
    }

    // Check for concurrent sync
    const inProgressSync = await prisma.syncLog.findFirst({
      where: {
        bankAccountId,
        status: 'in_progress',
      },
    });

    if (inProgressSync) {
      return {
        success: false,
        error: 'Sync already in progress',
      };
    }

    // Create sync log
    const syncLog = await prisma.syncLog.create({
      data: {
        bankAccountId,
        syncType: 'manual',
        status: 'in_progress',
      },
    });
    syncLogId = syncLog.id;

    // Determine sync start date (lastSyncAt or syncFromDate)
    const sinceDate = bankAccount.lastSyncAt || bankAccount.syncFromDate;

    // Abort the fetch when the manual-sync window closes; partial results are
    // still processed.
    const abortController = new AbortController();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
      console.warn(`Manual sync timeout approaching for bank account ${bankAccountId}, stopping gracefully`);
    }, TIMEOUT_MS);

    let allTransactions: MonzoTransaction[];
    try {
      // Token refresh (proactive + reactive 401), retry/backoff and pagination
      // are handled by `monzo-core`.
      allTransactions = await (await getMonzoClient(bankAccountId)).fetchAllTransactions({
        accountId: bankAccount.accountId,
        since: sinceDate,
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    // Process transactions through unified pipeline
    let processedCount = 0;
    transactionsFetched = allTransactions.length;
    if (allTransactions.length > 0) {
      const processResult = await processTransactions(allTransactions, bankAccountId);
      processedCount = processResult.processed;
      duplicatesSkipped = processResult.duplicatesSkipped;

      // Log any processing errors
      if (processResult.errors.length > 0) {
        console.error(`Manual sync encountered ${processResult.errors.length} errors:`, processResult.errors);
      }
    }

    // Determine final status
    const finalStatus = timedOut ? 'partial' : 'success';
    const now = new Date();

    // Update sync log
    await prisma.syncLog.update({
      where: { id: syncLogId },
      data: {
        status: finalStatus,
        completedAt: now,
        transactionsFetched,
        transactionsSkipped: duplicatesSkipped,
      },
    });

    // Update bank account (only update lastSyncAt on complete success)
    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        lastSyncAt: finalStatus === 'success' ? now : undefined,
        lastSyncStatus: finalStatus,
      },
    });

    console.log(`Manual sync completed for bank account ${bankAccountId}: ${transactionsFetched} transactions fetched (${processedCount} processed, ${duplicatesSkipped} duplicates skipped), status: ${finalStatus}`);

    return {
      success: true,
      transactionsFetched,
      lastSyncAt: finalStatus === 'success' ? now : bankAccount.lastSyncAt || undefined,
      lastSyncStatus: finalStatus,
    };
  } catch (error) {
    console.error(`Manual sync failed for bank account ${bankAccountId}:`, error);

    // Get user-friendly error message
    const errorMessage = getUserMessage(error);

    // Update sync log with error
    if (syncLogId) {
      await prisma.syncLog.update({
        where: { id: syncLogId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          transactionsFetched,
          transactionsSkipped: duplicatesSkipped,
          errorMessage,
          errorDetails: error instanceof Error ? error.stack : undefined,
        },
      });
    }

    // Update bank account status (don't update lastSyncAt on failure)
    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        lastSyncStatus: 'failed',
      },
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Register a webhook with Monzo API
 * @param accessToken - Monzo access token
 * @param accountId - Monzo account ID
 * @param webhookUrl - The URL where Monzo will send webhook events
 * @returns Webhook ID and URL
 */
export async function registerWebhook(
  accessToken: string,
  accountId: string,
  webhookUrl: string
): Promise<WebhookRegistrationResult> {
  const client = await getPendingMonzoClient(accessToken, undefined, 3600);
  const webhook = await client.registerWebhook(accountId, webhookUrl);

  return {
    webhookId: webhook.id,
    webhookUrl: webhook.url,
  };
}

/**
 * Delete a webhook from Monzo API
 * @param accessToken - Monzo access token
 * @param webhookId - The webhook ID to delete
 */
export async function deleteWebhook(accessToken: string, webhookId: string): Promise<void> {
  const client = await getPendingMonzoClient(accessToken, undefined, 3600);
  await client.deleteWebhook(webhookId);
}
