import { useCallback, useEffect, useState } from 'react';
import { bankService } from '../services/api/bank.service';
import type { MonzoSettingsResponse } from '../services/api/bank.service';
import { ApiError } from '../types/api.types';

/** True when an API error means the Monzo OAuth client has not been configured yet. */
export function isMonzoNotConfiguredError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.message === 'monzo_not_configured';
}

/**
 * Shared state for the Monzo setup wizard used by Settings and Admin > Bank Accounts.
 * Settings are only fetched (and the wizard only offered) for admins.
 */
export function useMonzoSetup(isAdmin: boolean) {
  const [settings, setSettings] = useState<MonzoSettingsResponse | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    bankService
      .getMonzoSettings()
      .then((result) => {
        if (!cancelled) setSettings(result);
      })
      .catch((err) => {
        console.error('Error fetching Monzo settings:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const openWizard = useCallback(() => setWizardOpen(true), []);
  const closeWizard = useCallback(() => setWizardOpen(false), []);

  /** Open the wizard if Monzo needs setting up (admins only); returns true if it did. */
  const openWizardIfUnconfigured = useCallback((): boolean => {
    if (isAdmin && settings && !settings.configured) {
      setWizardOpen(true);
      return true;
    }
    return false;
  }, [isAdmin, settings]);

  /** Handle a failed connect call; returns true if it was a not-configured error that opened the wizard. */
  const handleConnectError = useCallback(
    (err: unknown): boolean => {
      if (isAdmin && isMonzoNotConfiguredError(err)) {
        setSettings((current) => (current ? { ...current, configured: false } : current));
        setWizardOpen(true);
        return true;
      }
      return false;
    },
    [isAdmin]
  );

  const handleSaved = useCallback((saved: MonzoSettingsResponse) => {
    setSettings(saved);
    setWizardOpen(false);
  }, []);

  return {
    settings,
    wizardOpen,
    openWizard,
    closeWizard,
    openWizardIfUnconfigured,
    handleConnectError,
    handleSaved,
  };
}
