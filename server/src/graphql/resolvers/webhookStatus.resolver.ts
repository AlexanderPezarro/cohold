import { assertAccess, assertRole, ApiContext } from '../auth.js';
import prisma from '../../db/client.js';
import type {
  WebhookEvent,
  AccountWebhookStatus,
  WebhookStatusData,
} from '../../../../shared/types/index.js';

// Net-new resolver: REST's GET /api/bank/webhooks/status (requireAuth,
// requireAdmin) had no GraphQL equivalent despite the design summary listing it
// as covered. The aggregation below is ported verbatim from
// server/src/routes/webhook-status.ts.
//
// Gate: session callers must be ADMIN (assertRole); API-key callers need the new
// webhook_status:read scope (assertAccess) - consistent with the rest of the
// resolvers, role checks stay session-only.

export const webhookStatusResolvers = {
  Query: {
    webhookStatus: async (_: unknown, __: unknown, context: ApiContext): Promise<WebhookStatusData> => {
      assertAccess(context, 'webhook_status:read');
      assertRole(context, 'ADMIN');

      const accountsWithWebhooks = await prisma.bankAccount.findMany({
        where: { webhookId: { not: null } },
        select: { id: true, accountName: true, webhookId: true },
        orderBy: { accountName: 'asc' },
      });

      const recentWebhookLogs = await prisma.syncLog.findMany({
        where: { syncType: 'webhook' },
        include: { bankAccount: { select: { id: true, accountName: true } } },
        orderBy: { startedAt: 'desc' },
        take: 20,
      });

      const lastEventTimestamp =
        recentWebhookLogs.length > 0 ? recentWebhookLogs[0].startedAt.toISOString() : null;

      const recentEvents: WebhookEvent[] = recentWebhookLogs.map((log) => ({
        id: log.id,
        accountId: log.bankAccount.id,
        accountName: log.bankAccount.accountName,
        status: log.status,
        startedAt: log.startedAt.toISOString(),
        completedAt: log.completedAt ? log.completedAt.toISOString() : null,
        errorMessage: log.errorMessage,
        webhookEventId: log.webhookEventId,
        transactionsFetched: log.transactionsFetched,
      }));

      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const failedCount24h = await prisma.syncLog.count({
        where: { syncType: 'webhook', status: 'failed', startedAt: { gte: oneDayAgo } },
      });
      const failedCount1h = await prisma.syncLog.count({
        where: { syncType: 'webhook', status: 'failed', startedAt: { gte: oneHourAgo } },
      });

      // Per-account latest status via groupBy + a single follow-up query (avoids N+1).
      const accountIds = accountsWithWebhooks.map((acc) => acc.id);
      const latestWebhookLogs = await prisma.syncLog.groupBy({
        by: ['bankAccountId'],
        where: { bankAccountId: { in: accountIds }, syncType: 'webhook' },
        _max: { startedAt: true },
      });

      const latestLogDetails = await prisma.syncLog.findMany({
        where: {
          syncType: 'webhook',
          OR: latestWebhookLogs.map((log) => ({
            bankAccountId: log.bankAccountId,
            startedAt: log._max.startedAt!,
          })),
        },
        select: { bankAccountId: true, status: true, startedAt: true },
      });

      const webhookStatusMap = new Map(latestLogDetails.map((log) => [log.bankAccountId, log]));

      const accountStatuses: AccountWebhookStatus[] = accountsWithWebhooks.map((account) => {
        const lastWebhook = webhookStatusMap.get(account.id);
        return {
          accountId: account.id,
          accountName: account.accountName,
          lastWebhookAt: lastWebhook ? lastWebhook.startedAt.toISOString() : null,
          lastWebhookStatus: lastWebhook ? lastWebhook.status : null,
          webhookId: account.webhookId,
        };
      });

      return { lastEventTimestamp, recentEvents, failedCount24h, failedCount1h, accountStatuses };
    },
  },
};
