import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/permissions.js';
import matchingRulesService from '../services/matchingRules.js';
import {
  CreateMatchingRuleSchema,
  UpdateMatchingRuleSchema,
  ReorderRulesSchema,
  TestRuleSchema,
} from '../../../shared/validation/matchingRule.validation.js';
import { z } from 'zod';

const router = Router();

// GET /api/bank/accounts/:accountId/rules - List all rules for a bank account
router.get('/accounts/:accountId/rules', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { accountId } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(accountId).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid bank account ID format',
      });
    }

    const rules = await matchingRulesService.listRulesForAccount(accountId);

    return res.json({
      success: true,
      rules,
    });
  } catch (error) {
    console.error('Get matching rules error:', error);

    if (error instanceof Error && error.message === 'Bank account not found') {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching matching rules',
    });
  }
});

// POST /api/bank/accounts/:accountId/rules - Create a new rule for a bank account
router.post('/accounts/:accountId/rules', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { accountId } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(accountId).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid bank account ID format',
      });
    }

    // Validate request body
    const validationResult = CreateMatchingRuleSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    const { rule, reprocessing } = await matchingRulesService.createRule(
      accountId,
      validationResult.data
    );

    return res.status(201).json({
      success: true,
      rule,
      reprocessing: {
        processed: reprocessing.processed,
        approved: reprocessing.approved,
        failed: reprocessing.failed,
      },
    });
  } catch (error) {
    console.error('Create matching rule error:', error);

    if (error instanceof Error && error.message === 'Bank account not found') {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while creating matching rule',
    });
  }
});

// GET /api/bank/rules/:id - Get a single rule by ID
router.get('/rules/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid rule ID format',
      });
    }

    const rule = await matchingRulesService.getRuleById(id);

    return res.json({
      success: true,
      rule,
    });
  } catch (error) {
    console.error('Get matching rule error:', error);

    if (error instanceof Error && error.message === 'Matching rule not found') {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while fetching matching rule',
    });
  }
});

// PUT /api/bank/rules/:id - Update a rule
router.put('/rules/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid rule ID format',
      });
    }

    // Validate request body
    const validationResult = UpdateMatchingRuleSchema.safeParse({
      id,
      ...req.body,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    // Extract id from validated data and use rest for update
    const { id: _, ...updateData } = validationResult.data;

    const { rule, reprocessing } = await matchingRulesService.updateRule(id, updateData);

    return res.json({
      success: true,
      rule,
      reprocessing: {
        processed: reprocessing.processed,
        approved: reprocessing.approved,
        failed: reprocessing.failed,
      },
    });
  } catch (error) {
    console.error('Update matching rule error:', error);

    if (error instanceof Error) {
      if (error.message === 'Matching rule not found') {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message === 'Cannot modify global rules') {
        return res.status(403).json({
          success: false,
          error: error.message,
        });
      }
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while updating matching rule',
    });
  }
});

// DELETE /api/bank/rules/:id - Delete a rule
router.delete('/rules/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid rule ID format',
      });
    }

    const { reprocessing } = await matchingRulesService.deleteRule(id);

    return res.json({
      success: true,
      message: 'Matching rule deleted successfully',
      reprocessing: {
        processed: reprocessing.processed,
        approved: reprocessing.approved,
        failed: reprocessing.failed,
      },
    });
  } catch (error) {
    console.error('Delete matching rule error:', error);

    if (error instanceof Error) {
      if (error.message === 'Matching rule not found') {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message === 'Cannot delete global rules') {
        return res.status(403).json({
          success: false,
          error: error.message,
        });
      }
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while deleting matching rule',
    });
  }
});

// POST /api/bank/rules/reorder - Reorder rules
router.post('/rules/reorder', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Validate request body
    const validationResult = ReorderRulesSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    const { ruleIds } = validationResult.data;

    await matchingRulesService.reorderRules(ruleIds);

    return res.json({
      success: true,
      message: 'Rules reordered successfully',
    });
  } catch (error) {
    console.error('Reorder matching rules error:', error);

    if (error instanceof Error) {
      if (error.message === 'One or more rules not found') {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message === 'Cannot reorder global rules') {
        return res.status(403).json({
          success: false,
          error: error.message,
        });
      }
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while reordering matching rules',
    });
  }
});

// POST /api/bank/rules/:id/test - Test a rule against sample transaction
router.post('/rules/:id/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!z.string().uuid().safeParse(id).success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid rule ID format',
      });
    }

    // Validate request body
    const validationResult = TestRuleSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error.issues[0].message,
      });
    }

    const { matches, result } = await matchingRulesService.testRule(id, validationResult.data);

    return res.json({
      success: true,
      matches,
      result,
    });
  } catch (error) {
    console.error('Test matching rule error:', error);

    if (error instanceof Error && error.message === 'Matching rule not found') {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An error occurred while testing matching rule',
    });
  }
});

export default router;
