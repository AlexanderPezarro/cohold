import { useEffect, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { Dialog } from '../../primitives/Dialog';
import { Button } from '../../primitives/Button';
import { TextField } from '../../primitives/TextField';
import { Chip } from '../../primitives/Chip';
import { Tooltip } from '../../primitives/Tooltip';
import { ConfirmDialog } from '../ConfirmDialog';
import { toast } from '../../../contexts/ToastContext';
import { bankService } from '../../../services/api/bank.service';
import { MonzoSettingsUpdateSchema } from '../../../../../shared/validation/monzoSettings.validation';
import type {
  MonzoSettingsResponse,
  MonzoSettingsUpdate,
} from '../../../../../shared/validation/monzoSettings.validation';
import styles from './MonzoSetupWizard.module.scss';

export type MonzoSetupWizardStep = 1 | 2 | 3 | 4;

export interface MonzoSetupWizardProps {
  open: boolean;
  onClose: () => void;
  /** Current settings (from GET /bank/monzo/settings). Used to prefill and to detect edit mode. */
  initialSettings?: MonzoSettingsResponse;
  /** Called with the saved settings; the parent closes the wizard and opens the connect dialog. */
  onSaved: (settings: MonzoSettingsResponse) => void;
  /** Override the save call (stories/tests). Defaults to `bankService.updateMonzoSettings`. */
  onSave?: (input: MonzoSettingsUpdate) => Promise<MonzoSettingsResponse>;
  /** Force the starting step. Defaults to 1, or 3 when editing an existing configuration. */
  initialStep?: MonzoSetupWizardStep;
}

const MONZO_PORTAL_URL = 'https://developers.monzo.com/apps/new';

const STEP_TITLES: Record<MonzoSetupWizardStep, string> = {
  1: 'Create a Monzo developer client',
  2: "Fill in Monzo's form",
  3: 'Paste the credentials',
  4: 'Save and connect',
};

type FieldErrors = Partial<Record<keyof MonzoSettingsUpdate, string>>;

function errorMessageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message === 'client_secret_required'
      ? 'Enter the client secret from Monzo.'
      : err.message;
  }
  return 'Failed to save Monzo settings';
}

async function copyToClipboard(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`);
  }
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.copyRow}>
      <div className={styles.copyValue}>
        <span className={styles.copyLabel}>{label}</span>
        <code className={styles.code}>{value || '(not set)'}</code>
      </div>
      <Tooltip content={`Copy ${label.toLowerCase()}`}>
        <Button
          variant="icon"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => copyToClipboard(value, label)}
          disabled={!value}
        >
          <Copy size={16} />
        </Button>
      </Tooltip>
    </div>
  );
}

export function MonzoSetupWizard({
  open,
  onClose,
  initialSettings,
  onSaved,
  onSave,
  initialStep,
}: MonzoSetupWizardProps) {
  const isEdit = Boolean(initialSettings?.configured);
  const startStep: MonzoSetupWizardStep = initialStep ?? (isEdit ? 3 : 1);

  const [step, setStep] = useState<MonzoSetupWizardStep>(startStep);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [webhookBaseUrl, setWebhookBaseUrl] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Reset the form each time the wizard opens.
  useEffect(() => {
    if (!open) return;
    setStep(startStep);
    setClientId(initialSettings?.clientId ?? '');
    setClientSecret('');
    setRedirectUri(initialSettings?.redirectUri || initialSettings?.suggested.redirectUri || '');
    setWebhookBaseUrl(
      initialSettings?.webhookBaseUrl || initialSettings?.suggested.webhookBaseUrl || ''
    );
    setErrors({});
    setSaveError(null);
    setSaving(false);
    setConfirmOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hasExistingSecret = Boolean(initialSettings?.hasClientSecret);
  const previousClientId = initialSettings?.clientId ?? '';
  const clientIdChanged =
    Boolean(initialSettings?.hasBankAccounts) &&
    previousClientId !== '' &&
    clientId.trim() !== previousClientId;

  const input = (): MonzoSettingsUpdate => ({
    clientId,
    clientSecret,
    redirectUri,
    webhookBaseUrl,
  });

  function validate(): boolean {
    const result = MonzoSettingsUpdateSchema.safeParse(input());
    const fieldErrors: FieldErrors = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof MonzoSettingsUpdate;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
    }
    if (!hasExistingSecret && !clientSecret.trim() && !fieldErrors.clientSecret) {
      fieldErrors.clientSecret = 'Client secret is required';
    }
    setErrors(fieldErrors);
    return Object.keys(fieldErrors).length === 0;
  }

  function goNext() {
    if (step === 3) {
      if (!validate()) return;
      setStep(4);
      return;
    }
    setStep((step + 1) as MonzoSetupWizardStep);
  }

  function goBack() {
    setSaveError(null);
    setStep((step - 1) as MonzoSetupWizardStep);
  }

  async function save() {
    if (!validate()) {
      setStep(3);
      return;
    }
    setConfirmOpen(false);
    setSaving(true);
    setSaveError(null);
    try {
      const saveFn = onSave ?? bankService.updateMonzoSettings;
      const saved = await saveFn(input());
      onSaved(saved);
    } catch (err) {
      setSaveError(errorMessageOf(err));
    } finally {
      setSaving(false);
    }
  }

  function handleSaveClick() {
    if (clientIdChanged) {
      setConfirmOpen(true);
      return;
    }
    void save();
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} size="medium" disableBackdropClose>
        <Dialog.Title>Set up Monzo</Dialog.Title>
        <Dialog.Content>
          <div className={styles.body}>
            <ol className={styles.steps} aria-label="Setup progress">
              {([1, 2, 3, 4] as const).map((n) => (
                <li
                  key={n}
                  className={n === step ? styles.stepActive : n < step ? styles.stepDone : styles.step}
                  aria-current={n === step ? 'step' : undefined}
                >
                  <span className={styles.stepNumber}>{n}</span>
                  <span className={styles.stepLabel}>{STEP_TITLES[n]}</span>
                </li>
              ))}
            </ol>

            {step === 1 && (
              <div className={styles.section}>
                <h3 className={styles.heading}>{STEP_TITLES[1]}</h3>
                <p className={styles.text}>
                  Cohold connects to Monzo through an OAuth client that you own. Create one in the
                  Monzo developer portal; it only takes a minute.
                </p>
                <p className={styles.text}>
                  The portal signs you in with a magic link sent to your Monzo email, so approve the
                  login in the Monzo app or email first.
                </p>
                <a
                  className={styles.portalLink}
                  href={MONZO_PORTAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Monzo developer portal <ExternalLink size={14} />
                </a>
              </div>
            )}

            {step === 2 && (
              <div className={styles.section}>
                <h3 className={styles.heading}>{STEP_TITLES[2]}</h3>
                <p className={styles.text}>Enter these values in the new client form.</p>
                <CopyRow label="Name" value="Cohold" />
                <div className={styles.copyRow}>
                  <TextField
                    label="Redirect URL"
                    value={redirectUri}
                    onChange={(e) => setRedirectUri(e.target.value)}
                    error={Boolean(errors.redirectUri)}
                    helperText={
                      errors.redirectUri ??
                      'Must match exactly what you enter in Monzo. You can edit it if Cohold is served from a different address.'
                    }
                    fullWidth
                  />
                  <Tooltip content="Copy redirect url">
                    <Button
                      variant="icon"
                      aria-label="Copy redirect url"
                      onClick={() => copyToClipboard(redirectUri, 'Redirect URL')}
                      disabled={!redirectUri}
                    >
                      <Copy size={16} />
                    </Button>
                  </Tooltip>
                </div>
                <p className={styles.text}>Description is optional.</p>
                <div className={styles.confidential}>
                  <Chip label="Confidential" color="primary" size="small" />
                  <span>
                    Set Confidentiality to <strong>Confidential</strong>. Only confidential clients
                    receive refresh tokens, and without one the connection stops working when the
                    access token expires.
                  </span>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className={styles.section}>
                <h3 className={styles.heading}>{STEP_TITLES[3]}</h3>
                <p className={styles.text}>
                  Copy the Client ID and Client secret Monzo shows after you create the client.
                </p>
                <TextField
                  label="Client ID"
                  placeholder="oauth2client_…"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  error={Boolean(errors.clientId)}
                  helperText={errors.clientId}
                  autoComplete="off"
                  fullWidth
                />
                <TextField
                  label="Client secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  error={Boolean(errors.clientSecret)}
                  helperText={
                    errors.clientSecret ??
                    (hasExistingSecret ? 'Leave blank to keep the current secret' : undefined)
                  }
                  autoComplete="new-password"
                  fullWidth
                />
                <TextField
                  label="Webhook URL"
                  value={webhookBaseUrl}
                  onChange={(e) => setWebhookBaseUrl(e.target.value)}
                  error={Boolean(errors.webhookBaseUrl)}
                  helperText={
                    errors.webhookBaseUrl ??
                    'Public https address of this Cohold instance. Monzo sends new transactions here.'
                  }
                  fullWidth
                />
                {errors.redirectUri && (
                  <p className={styles.errorText} role="alert">
                    Redirect URL: {errors.redirectUri}
                  </p>
                )}
              </div>
            )}

            {step === 4 && (
              <div className={styles.section}>
                <h3 className={styles.heading}>{STEP_TITLES[4]}</h3>
                <p className={styles.text}>Review your Monzo settings, then save.</p>
                <dl className={styles.summary}>
                  <dt>Client ID</dt>
                  <dd>
                    <code className={styles.code}>{clientId.trim()}</code>
                  </dd>
                  <dt>Client secret</dt>
                  <dd>{clientSecret.trim() ? 'New secret entered' : 'Keeping current secret'}</dd>
                  <dt>Redirect URL</dt>
                  <dd>
                    <code className={styles.code}>{redirectUri.trim()}</code>
                  </dd>
                  <dt>Webhook URL</dt>
                  <dd>
                    <code className={styles.code}>{webhookBaseUrl.trim()}</code>
                  </dd>
                </dl>
                {clientIdChanged && (
                  <p className={styles.warning} role="alert">
                    You changed the client ID. Existing bank accounts were connected with the old
                    client and will need to be reconnected.
                  </p>
                )}
                {saveError && (
                  <p className={styles.errorText} role="alert">
                    {saveError}
                  </p>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
        <Dialog.Actions>
          <Button variant="text" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {step > 1 && (
            <Button variant="secondary" onClick={goBack} disabled={saving}>
              Back
            </Button>
          )}
          {step < 4 ? (
            <Button variant="primary" onClick={goNext}>
              Next
            </Button>
          ) : (
            <Button variant="primary" onClick={handleSaveClick} loading={saving} disabled={saving}>
              Save and connect
            </Button>
          )}
        </Dialog.Actions>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="Change Monzo client?"
        message="Existing bank accounts were connected with the previous client ID and will need to be reconnected. Save the new client anyway?"
        confirmLabel="Save anyway"
        onConfirm={() => void save()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
