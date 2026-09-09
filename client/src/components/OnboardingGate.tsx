import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOnboarding } from '../contexts/OnboardingContext';

/** Remembers that we already offered the flow, so we never nag twice. */
const SESSION_KEY = 'cohold.onboarding.redirected';

/**
 * Sends a brand new account to the setup flow once.
 *
 * Deliberately narrow: the server only sets `shouldRedirect` for an install
 * with no data at all and no dismissal, we only act from the dashboard, and we
 * only do it once per browser session. Anyone who wants the app instead can
 * navigate away and will not be pulled back.
 */
export const OnboardingGate: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, loading } = useOnboarding();

  useEffect(() => {
    if (loading || !status?.shouldRedirect) return;
    if (location.pathname !== '/dashboard' && location.pathname !== '/') return;

    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // Private mode or blocked storage: fall through and redirect anyway.
      // Worst case the user sees the flow once more than intended.
    }

    navigate('/onboarding', { replace: true });
  }, [loading, status, location.pathname, navigate]);

  return null;
};
