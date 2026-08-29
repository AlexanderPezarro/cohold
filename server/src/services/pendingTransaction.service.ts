import { Prisma } from '@prisma/client';
import prisma from '../db/client.js';
import transactionService from './transaction.service.js';
import type { BulkUpdate, TransactionType, TransactionCategory } from '../../../shared/validation/index.js';

/**
 * Thrown by bulkApprove when one or more pending transactions in the batch
 * fail validation. Carries the per-transaction error messages so the route
 * can return them as `details`, matching the pre-refactor response shape.
 */
export class BulkApprovalValidationError extends Error {
  details: string[];

  constructor(details: string[]) {
    super('Cannot approve transactions');
    this.name = 'BulkApprovalValidationError';
    this.details = details;
  }
}

export class PendingTransactionService {
  /**
   * Count unreviewed pending transactions.
   */
  async getUnreviewedCount() {
    return prisma.pendingTransaction.count({
      where: { reviewedAt: null },
    });
  }

  /**
   * List pending transactions with optional filters, flattened for the
   * frontend (bank transaction fields merged onto the pending transaction).
   */
  async listPendingTransactions(filters: {
    bankAccountId?: string;
    reviewStatus?: string;
    search?: string;
  }) {
    const where: Prisma.PendingTransactionWhereInput = {};

    // Filter by review status
    if (filters.reviewStatus === 'pending') {
      where.reviewedAt = null;
    } else if (filters.reviewStatus === 'reviewed') {
      where.reviewedAt = { not: null };
    } else {
      // Default: show only pending (unreviewed)
      where.reviewedAt = null;
    }

    // Filter by bank account
    if (filters.bankAccountId) {
      where.bankTransaction = {
        bankAccountId: filters.bankAccountId,
      };
    }

    // Search by description (SQLite is case-insensitive by default for LIKE)
    if (filters.search) {
      where.description = {
        contains: filters.search,
      };
    }

    const pendingTransactions = await prisma.pendingTransaction.findMany({
      where,
      include: {
        bankTransaction: {
          include: {
            bankAccount: {
              select: {
                id: true,
                accountName: true,
                accountType: true,
                provider: true,
              },
            },
          },
        },
      },
      orderBy: {
        transactionDate: 'desc',
      },
    });

    // Flatten the response for easier frontend consumption
    return pendingTransactions.map((pt) => ({
      id: pt.id,
      bankTransactionId: pt.bankTransactionId,
      propertyId: pt.propertyId,
      leaseId: pt.leaseId,
      type: pt.type,
      category: pt.category,
      transactionDate: pt.transactionDate,
      description: pt.description,
      amount: pt.bankTransaction.amount,
      currency: pt.bankTransaction.currency,
      reviewedAt: pt.reviewedAt,
      reviewedBy: pt.reviewedBy,
      createdAt: pt.createdAt,
      bankAccount: pt.bankTransaction.bankAccount,
      bankTransaction: {
        id: pt.bankTransaction.id,
        externalId: pt.bankTransaction.externalId,
        amount: pt.bankTransaction.amount,
        currency: pt.bankTransaction.currency,
        description: pt.bankTransaction.description,
        counterpartyName: pt.bankTransaction.counterpartyName,
        reference: pt.bankTransaction.reference,
        merchant: pt.bankTransaction.merchant,
        category: pt.bankTransaction.category,
        transactionDate: pt.bankTransaction.transactionDate,
        settledDate: pt.bankTransaction.settledDate,
      },
    }));
  }

  /**
   * Update editable fields (propertyId, leaseId, type, category) on a single
   * pending transaction.
   */
  async updatePendingTransaction(
    id: string,
    data: { propertyId?: string; leaseId?: string; type?: string; category?: string }
  ) {
    // Check if pending transaction exists
    const existingPending = await prisma.pendingTransaction.findUnique({
      where: { id },
    });

    if (!existingPending) {
      throw new Error('Pending transaction not found');
    }

    const { propertyId, leaseId, type, category } = data;

    // Validate property exists if propertyId is provided
    if (propertyId) {
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
      });

      if (!property) {
        throw new Error('Property not found');
      }
    }

    // Validate lease exists if leaseId is provided
    if (leaseId) {
      const lease = await prisma.lease.findUnique({
        where: { id: leaseId },
      });

      if (!lease) {
        throw new Error('Lease not found');
      }
    }

    // Build update data
    const updateData: {
      propertyId?: string;
      leaseId?: string;
      type?: string;
      category?: string;
    } = {};
    if (propertyId !== undefined) updateData.propertyId = propertyId;
    if (leaseId !== undefined) updateData.leaseId = leaseId;
    if (type !== undefined) updateData.type = type;
    if (category !== undefined) updateData.category = category;

    // Update pending transaction
    const updatedPending = await prisma.pendingTransaction.update({
      where: { id },
      data: updateData,
      include: {
        bankTransaction: {
          include: {
            bankAccount: {
              select: {
                id: true,
                accountName: true,
                accountType: true,
                provider: true,
              },
            },
          },
        },
      },
    });

    return {
      id: updatedPending.id,
      bankTransactionId: updatedPending.bankTransactionId,
      propertyId: updatedPending.propertyId,
      leaseId: updatedPending.leaseId,
      type: updatedPending.type,
      category: updatedPending.category,
      transactionDate: updatedPending.transactionDate,
      description: updatedPending.description,
      amount: updatedPending.bankTransaction.amount,
      currency: updatedPending.bankTransaction.currency,
      reviewedAt: updatedPending.reviewedAt,
      reviewedBy: updatedPending.reviewedBy,
      createdAt: updatedPending.createdAt,
      bankAccount: updatedPending.bankTransaction.bankAccount,
    };
  }

  /**
   * Approve a single pending transaction: creates the real Transaction
   * (routed through transactionService.createTransaction so ownership
   * splits are generated the same way manually-entered transactions get
   * them), links the bank transaction to it, and marks the pending
   * transaction reviewed. All in one DB transaction for atomicity.
   */
  async approvePendingTransaction(id: string, userId: string) {
    const pendingTx = await prisma.pendingTransaction.findUnique({
      where: { id },
      include: {
        bankTransaction: true,
      },
    });

    if (!pendingTx) {
      throw new Error('Pending transaction not found');
    }

    if (pendingTx.reviewedAt) {
      throw new Error('This pending transaction has already been reviewed');
    }

    if (!pendingTx.propertyId) {
      throw new Error('propertyId is required before approval');
    }

    if (!pendingTx.type) {
      throw new Error('type is required before approval');
    }

    if (!pendingTx.category) {
      throw new Error('category is required before approval');
    }

    return prisma.$transaction(async (tx) => {
      const transaction = await transactionService.createTransaction(
        {
          propertyId: pendingTx.propertyId!,
          leaseId: pendingTx.leaseId,
          type: pendingTx.type as TransactionType,
          category: pendingTx.category as TransactionCategory,
          amount: pendingTx.bankTransaction.amount,
          transactionDate: pendingTx.transactionDate,
          description: pendingTx.description,
          bankTransactionId: pendingTx.bankTransactionId,
          isImported: true,
          importedAt: new Date(),
        },
        tx
      );

      // Update bank transaction to link to the new transaction
      await tx.bankTransaction.update({
        where: { id: pendingTx.bankTransactionId },
        data: {
          transactionId: transaction.id,
        },
      });

      // Mark pending transaction as reviewed
      await tx.pendingTransaction.update({
        where: { id },
        data: {
          reviewedAt: new Date(),
          reviewedBy: userId,
        },
      });

      return transaction;
    });
  }

  /**
   * Approve a batch of pending transactions atomically: either all succeed
   * (each routed through transactionService.createTransaction so splits are
   * generated) or the whole batch rolls back. Every create/update in the
   * loop is issued against the same prisma.$transaction handle so a
   * mid-batch failure leaves no partial state.
   */
  async bulkApprove(ids: string[], userId: string) {
    const pendingTransactions = await prisma.pendingTransaction.findMany({
      where: {
        id: { in: ids },
      },
      include: {
        bankTransaction: true,
      },
    });

    // Check all exist
    if (pendingTransactions.length !== ids.length) {
      throw new Error('One or more pending transactions not found');
    }

    // Validate all transactions are ready for approval
    const errors: string[] = [];
    for (const pt of pendingTransactions) {
      if (pt.reviewedAt) {
        errors.push(`Transaction ${pt.id} has already been reviewed`);
      }
      if (!pt.propertyId) {
        errors.push(`Transaction ${pt.id} is missing propertyId`);
      }
      if (!pt.type) {
        errors.push(`Transaction ${pt.id} is missing type`);
      }
      if (!pt.category) {
        errors.push(`Transaction ${pt.id} is missing category`);
      }
    }

    if (errors.length > 0) {
      throw new BulkApprovalValidationError(errors);
    }

    // Approve all in a single database transaction so a mid-batch failure
    // rolls back everything (including any splits already generated).
    return prisma.$transaction(async (tx) => {
      const transactions = [];

      for (const pt of pendingTransactions) {
        const transaction = await transactionService.createTransaction(
          {
            propertyId: pt.propertyId!,
            leaseId: pt.leaseId,
            type: pt.type as TransactionType,
            category: pt.category as TransactionCategory,
            amount: pt.bankTransaction.amount,
            transactionDate: pt.transactionDate,
            description: pt.description,
            bankTransactionId: pt.bankTransactionId,
            isImported: true,
            importedAt: new Date(),
          },
          tx
        );

        // Update bank transaction to link to the new transaction
        await tx.bankTransaction.update({
          where: { id: pt.bankTransactionId },
          data: {
            transactionId: transaction.id,
          },
        });

        // Mark pending transaction as reviewed
        await tx.pendingTransaction.update({
          where: { id: pt.id },
          data: {
            reviewedAt: new Date(),
            reviewedBy: userId,
          },
        });

        transactions.push(transaction);
      }

      return transactions;
    });
  }

  /**
   * Bulk-update editable fields on a set of (unreviewed) pending
   * transactions.
   */
  async bulkUpdate(ids: string[], updates: BulkUpdate['updates']) {
    const { propertyId, leaseId, type, category } = updates;

    // Pre-validate that transactions haven't been reviewed
    const pendingTransactions = await prisma.pendingTransaction.findMany({
      where: { id: { in: ids } },
    });

    const alreadyReviewed = pendingTransactions.filter((pt) => pt.reviewedAt);
    if (alreadyReviewed.length > 0) {
      throw new Error(
        `Cannot update ${alreadyReviewed.length} transaction(s) that have already been reviewed`
      );
    }

    // Validate property exists if propertyId is provided
    if (propertyId !== undefined && propertyId !== null) {
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
      });

      if (!property) {
        throw new Error('Property not found');
      }
    }

    // Validate lease exists if leaseId is provided
    if (leaseId !== undefined && leaseId !== null) {
      const lease = await prisma.lease.findUnique({
        where: { id: leaseId },
      });

      if (!lease) {
        throw new Error('Lease not found');
      }

      // If both leaseId and propertyId are provided, validate the relationship
      if (propertyId !== undefined && propertyId !== null) {
        if (lease.propertyId !== propertyId) {
          throw new Error('Lease does not belong to the specified property');
        }
      }
    }

    // Build update data
    const updateData: {
      propertyId?: string | null;
      leaseId?: string | null;
      type?: string | null;
      category?: string | null;
    } = {};
    if (propertyId !== undefined) updateData.propertyId = propertyId;
    if (leaseId !== undefined) updateData.leaseId = leaseId;
    if (type !== undefined) updateData.type = type;
    if (category !== undefined) updateData.category = category;

    // Update all pending transactions
    const result = await prisma.pendingTransaction.updateMany({
      where: {
        id: { in: ids },
        reviewedAt: null, // Only update unreviewed transactions
      },
      data: updateData,
    });

    return result.count;
  }

  /**
   * Bulk-reject (delete) a set of (unreviewed) pending transactions.
   */
  async bulkReject(ids: string[]) {
    // Pre-validate that transactions haven't been reviewed
    const pendingTransactions = await prisma.pendingTransaction.findMany({
      where: { id: { in: ids } },
    });

    const alreadyReviewed = pendingTransactions.filter((pt) => pt.reviewedAt);
    if (alreadyReviewed.length > 0) {
      throw new Error(
        `Cannot reject ${alreadyReviewed.length} transaction(s) that have already been reviewed`
      );
    }

    // Delete only unreviewed pending transactions
    const result = await prisma.pendingTransaction.deleteMany({
      where: {
        id: { in: ids },
        reviewedAt: null, // Only delete unreviewed transactions
      },
    });

    return result.count;
  }
}

export default new PendingTransactionService();
