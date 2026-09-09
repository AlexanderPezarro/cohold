/**
 * Onboarding checklist API.
 *
 * Every response returns the whole recomputed status, so the client can replace
 * its state after an action instead of re-fetching and guessing at ordering.
 *
 * Only the user's own decisions are written here (skip / dismiss / restart), so
 * these are `requireAuth` rather than `requireWrite` - a VIEWER still gets a
 * checklist, just one whose steps mostly point at pages they can read.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import onboardingService from '../services/onboarding.service.js';
import { isOnboardingStepId, type OnboardingStepId } from '../../../shared/onboarding/steps.js';
import { DomainError } from '../services/errors.js';

const router = Router();

/** Resolves and validates `:stepId`, replying 404 for an unknown step. */
function parseStepId(req: { params: Record<string, string> }): OnboardingStepId | null {
  const { stepId } = req.params;
  return isOnboardingStepId(stepId) ? stepId : null;
}

async function respondWithStatus(
  userId: string,
  role: 'ADMIN' | 'LANDLORD' | 'VIEWER',
  res: import('express').Response,
  statusCode = 200
) {
  const onboarding = await onboardingService.getOnboardingStatus(userId, role);
  return res.status(statusCode).json({ success: true, onboarding });
}

// GET /api/onboarding - Current checklist state for the logged-in user
router.get('/', requireAuth, async (req, res) => {
  try {
    return await respondWithStatus(req.user!.id, req.user!.role, res);
  } catch (error) {
    console.error('Get onboarding status error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while loading onboarding status',
    });
  }
});

// POST /api/onboarding/steps/:stepId/skip - Pass over a step
router.post('/steps/:stepId/skip', requireAuth, async (req, res) => {
  const stepId = parseStepId(req);
  if (!stepId) {
    return res.status(404).json({ success: false, error: 'Unknown onboarding step' });
  }

  try {
    await onboardingService.setStepOverride(req.user!.id, stepId, 'skipped');
    return await respondWithStatus(req.user!.id, req.user!.role, res);
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    console.error('Skip onboarding step error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while skipping the step',
    });
  }
});

// DELETE /api/onboarding/steps/:stepId/skip - Undo a skip
router.delete('/steps/:stepId/skip', requireAuth, async (req, res) => {
  const stepId = parseStepId(req);
  if (!stepId) {
    return res.status(404).json({ success: false, error: 'Unknown onboarding step' });
  }

  try {
    await onboardingService.clearStepOverride(req.user!.id, stepId);
    return await respondWithStatus(req.user!.id, req.user!.role, res);
  } catch (error) {
    console.error('Unskip onboarding step error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while restoring the step',
    });
  }
});

// POST /api/onboarding/steps/:stepId/complete - Tick off a step whose
// completion isn't derivable from data (registry `manual` steps only)
router.post('/steps/:stepId/complete', requireAuth, async (req, res) => {
  const stepId = parseStepId(req);
  if (!stepId) {
    return res.status(404).json({ success: false, error: 'Unknown onboarding step' });
  }

  try {
    await onboardingService.setStepOverride(req.user!.id, stepId, 'completed');
    return await respondWithStatus(req.user!.id, req.user!.role, res);
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    console.error('Complete onboarding step error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while completing the step',
    });
  }
});

// POST /api/onboarding/dismiss - Hide the checklist
router.post('/dismiss', requireAuth, async (req, res) => {
  try {
    await onboardingService.setDismissed(req.user!.id, true);
    return await respondWithStatus(req.user!.id, req.user!.role, res);
  } catch (error) {
    console.error('Dismiss onboarding error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while dismissing onboarding',
    });
  }
});

// POST /api/onboarding/restart - Clear every decision and show it again
router.post('/restart', requireAuth, async (req, res) => {
  try {
    await onboardingService.restart(req.user!.id);
    return await respondWithStatus(req.user!.id, req.user!.role, res);
  } catch (error) {
    console.error('Restart onboarding error:', error);
    return res.status(500).json({
      success: false,
      error: 'An error occurred while restarting onboarding',
    });
  }
});

export default router;
