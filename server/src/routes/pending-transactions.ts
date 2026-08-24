import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/permissions.js';
import { z } from 'zod';
import { bulkIdsSchema, bulkUpdateSchema } from '../../../shared/validation/index.js';
import pendingTransactionService, {
  BulkApprovalValidationError,
} from '../services/pendingTransaction.service.js';

const router = Router();

// GET /api/pending-transactions/count - Get count of unreviewed pending transactions
router.get('/count', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const count = await pendingTransactionService.getUnreviewedCount();

    return res.json({
      success: true,
      count,
    });
  } catch (error) {
    console.error('Get pending transactions count error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching pending transactions count',
    });
  }
});

// POST /api/pending-transactions/bulk/approve - Bulk approve pending transactions
router.post('/bulk/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Validate input using Zod schema
    const validation = bulkIdsSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: validation.error.issues[0].message,
      });
    }

    const { ids } = validation.data;
    const userId = req.user!.id;

    const results = await pendingTransactionService.bulkApprove(ids, userId);

    return res.json({
      success: true,
      count: results.length,
      transactions: results,
      message: `Successfully approved ${results.length} transaction(s)`,
    });
  } catch (error) {
    console.error('Bulk approve pending transactions error:', error);

    if (error instanceof BulkApprovalValidationError) {
      return res.status(400).json({
        success: false,
        error: error.message,
        details: error.details,
      });
    }

    if (error instanceof Error && error.message === 'One or more pending transactions not found') {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while bulk approving pending transactions',
    });
  }
});

// POST /api/pending-transactions/bulk/update - Bulk update pending transactions
router.post('/bulk/update', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Validate input using Zod schema
    const validation = bulkUpdateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: validation.error.issues[0].message,
      });
    }

    const { ids, updates } = validation.data;

    const count = await pendingTransactionService.bulkUpdate(ids, updates);

    return res.json({
      success: true,
      count,
      message: `Successfully updated ${count} transaction(s)`,
    });
  } catch (error) {
    console.error('Bulk update pending transactions error:', error);

    if (
      error instanceof Error &&
      (error.message.includes('already been reviewed') ||
        error.message === 'Property not found' ||
        error.message === 'Lease not found' ||
        error.message === 'Lease does not belong to the specified property')
    ) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while bulk updating pending transactions',
    });
  }
});

// POST /api/pending-transactions/bulk/reject - Bulk reject (delete) pending transactions
router.post('/bulk/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Validate input using Zod schema
    const validation = bulkIdsSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: validation.error.issues[0].message,
      });
    }

    const { ids } = validation.data;

    const count = await pendingTransactionService.bulkReject(ids);

    return res.json({
      success: true,
      count,
      message: `Successfully rejected ${count} transaction(s)`,
    });
  } catch (error) {
    console.error('Bulk reject pending transactions error:', error);

    if (error instanceof Error && error.message.includes('already been reviewed')) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while bulk rejecting pending transactions',
    });
  }
});

// GET /api/pending-transactions - List all pending transactions with filters
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { bank_account_id, review_status, search } = req.query;

    const formattedTransactions = await pendingTransactionService.listPendingTransactions({
      bankAccountId: typeof bank_account_id === 'string' ? bank_account_id : undefined,
      reviewStatus: typeof review_status === 'string' ? review_status : undefined,
      search: typeof search === 'string' ? search : undefined,
    });

    return res.json({
      success: true,
      pendingTransactions: formattedTransactions,
    });
  } catch (error) {
    console.error('Get pending transactions error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching pending transactions',
    });
  }
});

// PATCH /api/pending-transactions/:id - Update pending transaction fields
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid pending transaction ID format',
      });
    }

    // Extract updatable fields from request
    const { propertyId, leaseId, type, category } = req.body;

    const pendingTransaction = await pendingTransactionService.updatePendingTransaction(id, {
      propertyId,
      leaseId,
      type,
      category,
    });

    return res.json({
      success: true,
      pendingTransaction,
    });
  } catch (error) {
    console.error('Update pending transaction error:', error);

    if (error instanceof Error && error.message === 'Pending transaction not found') {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    if (
      error instanceof Error &&
      (error.message === 'Property not found' || error.message === 'Lease not found')
    ) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while updating pending transaction',
    });
  }
});

// POST /api/pending-transactions/:id/approve - Approve and create transaction
router.post('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid pending transaction ID format',
      });
    }

    const transaction = await pendingTransactionService.approvePendingTransaction(id, userId);

    return res.json({
      success: true,
      transaction,
      message: 'Transaction approved and created successfully',
    });
  } catch (error) {
    console.error('Approve pending transaction error:', error);

    if (error instanceof Error && error.message === 'Pending transaction not found') {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    if (
      error instanceof Error &&
      (error.message === 'This pending transaction has already been reviewed' ||
        error.message === 'propertyId is required before approval' ||
        error.message === 'type is required before approval' ||
        error.message === 'category is required before approval')
    ) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while approving pending transaction',
    });
  }
});

export default router;
