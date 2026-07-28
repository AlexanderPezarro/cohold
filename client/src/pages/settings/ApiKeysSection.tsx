import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Key, Copy, Trash2, AlertTriangle } from 'lucide-react';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { TextField } from '../../components/primitives/TextField';
import { Table } from '../../components/primitives/Table';
import { Chip } from '../../components/primitives/Chip';
import { Dialog } from '../../components/primitives/Dialog';
import { DatePicker } from '../../components/primitives/DatePicker';
import { Spinner } from '../../components/primitives/Spinner';
import { Divider } from '../../components/primitives/Divider';
import { ConfirmDialog } from '../../components/composed/ConfirmDialog';
import { apiKeysService } from '../../services/api/apiKeys.service';
import { useToast } from '../../contexts/ToastContext';
import type { ApiKeyListItem, ApiKeyScope } from '../../../../shared/types/apiKey.types';
import styles from './ApiKeysSection.module.scss';
import settingsStyles from '../Settings.module.scss';

const SCOPE_GROUPS = [
  { resource: 'properties', label: 'Properties', hasWrite: true },
  { resource: 'tenants', label: 'Tenants', hasWrite: true },
  { resource: 'leases', label: 'Leases', hasWrite: true },
  { resource: 'transactions', label: 'Transactions', hasWrite: true },
  { resource: 'events', label: 'Events', hasWrite: true },
  { resource: 'documents', label: 'Documents', hasWrite: true },
  { resource: 'bank_accounts', label: 'Bank Accounts', hasWrite: true },
  { resource: 'matching_rules', label: 'Matching Rules', hasWrite: true },
  { resource: 'settlements', label: 'Settlements', hasWrite: true },
  { resource: 'sync_logs', label: 'Sync Logs', hasWrite: false },
  { resource: 'transaction_audit_logs', label: 'Transaction Audit Logs', hasWrite: false },
] as const;

const getKeyStatus = (key: ApiKeyListItem): 'active' | 'revoked' | 'expired' => {
  if (key.revokedAt) return 'revoked';
  if (new Date(key.expiresAt) < new Date()) return 'expired';
  return 'active';
};

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export const ApiKeysSection: React.FC = () => {
  const toast = useToast();

  const [keys, setKeys] = useState<ApiKeyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});

  const [revealOpen, setRevealOpen] = useState(false);
  const [rawKey, setRawKey] = useState('');

  const [revokeOpen, setRevokeOpen] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyListItem | null>(null);

  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 1);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchedKeys = await apiKeysService.listKeys();
      setKeys(fetchedKeys);
    } catch (err) {
      console.error('Error fetching API keys:', err);
      const message = 'Failed to load API keys';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleToggleScope = (scope: ApiKeyScope) => {
    setScopes((prev) => {
      const isChecked = prev.includes(scope);

      if (isChecked) {
        if (scope.endsWith(':read')) {
          const writeScope = scope.replace(':read', ':write') as ApiKeyScope;
          return prev.filter((s) => s !== scope && s !== writeScope);
        }
        return prev.filter((s) => s !== scope);
      } else {
        if (scope.endsWith(':write')) {
          const readScope = scope.replace(':write', ':read') as ApiKeyScope;
          const next = prev.includes(readScope) ? prev : [...prev, readScope];
          return [...next, scope];
        }
        return [...prev, scope];
      }
    });

    if (createErrors.scopes) {
      setCreateErrors((prev) => {
        const next = { ...prev };
        delete next.scopes;
        return next;
      });
    }
  };

  const handleOpenCreate = () => {
    setName('');
    setScopes([]);
    setExpiresAt(null);
    setCreateErrors({});
    setCreateOpen(true);
  };

  const handleCloseCreate = () => {
    setCreateOpen(false);
  };

  const handleCreate = async () => {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = 'Name is required';
    if (scopes.length === 0) errors.scopes = 'At least one scope is required';
    if (!expiresAt) errors.expiresAt = 'Expiry date is required';

    if (Object.keys(errors).length > 0) {
      setCreateErrors(errors);
      return;
    }

    try {
      setCreateLoading(true);
      const created = await apiKeysService.createKey({
        name: name.trim(),
        scopes,
        expiresAt: expiresAt!.toISOString(),
      });
      setRawKey(created.rawKey);
      setCreateOpen(false);
      setRevealOpen(true);
      await fetchKeys();
    } catch (err) {
      console.error('Error creating API key:', err);
      toast.error('Failed to create API key');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCopyKey = async () => {
    try {
      await navigator.clipboard.writeText(rawKey);
      toast.success('API key copied to clipboard');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleRevokeClick = (key: ApiKeyListItem) => {
    setKeyToRevoke(key);
    setRevokeOpen(true);
  };

  const handleRevokeCancel = () => {
    setRevokeOpen(false);
    setKeyToRevoke(null);
  };

  const handleRevoke = async () => {
    if (!keyToRevoke) return;
    try {
      await apiKeysService.revokeKey(keyToRevoke.id);
      toast.success('API key revoked');
      setRevokeOpen(false);
      setKeyToRevoke(null);
      await fetchKeys();
    } catch (err) {
      console.error('Error revoking API key:', err);
      toast.error('Failed to revoke API key');
    }
  };

  return (
    <>
      <Card className={settingsStyles.section}>
        <Card.Content>
          <div className={settingsStyles.sectionHeader}>
            <h2 className={settingsStyles.sectionTitle}>API Keys</h2>
            <Button variant="primary" startIcon={<Plus size={18} />} onClick={handleOpenCreate}>
              Create API Key
            </Button>
          </div>
          <Divider spacing={3} />

          {loading ? (
            <div className={settingsStyles.loadingCenter}>
              <Spinner size="small" />
            </div>
          ) : error ? (
            <p className={settingsStyles.emptyText}>{error}</p>
          ) : keys.length === 0 ? (
            <p className={settingsStyles.emptyText}>
              No API keys yet. Create one to integrate with the Cohold API.
            </p>
          ) : (
            <Table.Container>
              <Table>
                <Table.Head>
                  <Table.Row>
                    <Table.Cell sortable={false}>Name</Table.Cell>
                    <Table.Cell sortable={false}>Prefix</Table.Cell>
                    <Table.Cell sortable={false}>Scopes</Table.Cell>
                    <Table.Cell sortable={false}>Expires</Table.Cell>
                    <Table.Cell sortable={false}>Status</Table.Cell>
                    <Table.Cell sortable={false} align="right">Actions</Table.Cell>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {keys.map((key) => {
                    const status = getKeyStatus(key);
                    const isInactive = status !== 'active';
                    const visibleScopes = key.scopes.slice(0, 3);
                    const extraCount = key.scopes.length - 3;

                    return (
                      <Table.Row key={key.id}>
                        <Table.Cell>{key.name}</Table.Cell>
                        <Table.Cell>
                          <span className={styles.prefixCode}>{key.keyPrefix}...</span>
                        </Table.Cell>
                        <Table.Cell>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                            {visibleScopes.map((scope) => (
                              <Chip key={scope} label={scope} size="small" />
                            ))}
                            {extraCount > 0 && (
                              <span style={{ fontSize: 'inherit', color: 'inherit' }}>+{extraCount} more</span>
                            )}
                          </div>
                        </Table.Cell>
                        <Table.Cell>{formatDate(key.expiresAt)}</Table.Cell>
                        <Table.Cell>
                          <Chip
                            label={status.charAt(0).toUpperCase() + status.slice(1)}
                            color={status === 'active' ? 'success' : 'error'}
                            size="small"
                          />
                        </Table.Cell>
                        <Table.Cell align="right">
                          <button
                            type="button"
                            className={styles.revokeButton}
                            onClick={() => handleRevokeClick(key)}
                            disabled={isInactive}
                            title={isInactive ? `Key is ${status}` : 'Revoke key'}
                            style={isInactive ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                          >
                            <Trash2 size={18} />
                          </button>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                  {keys.length === 0 && <Table.Empty colSpan={6}>No API keys found</Table.Empty>}
                </Table.Body>
              </Table>
            </Table.Container>
          )}
        </Card.Content>
      </Card>

      <Dialog open={createOpen} onClose={handleCloseCreate} size="large">
        <Dialog.Title>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Key size={20} />
            Create API Key
          </span>
        </Dialog.Title>
        <Dialog.Content>
          <div className={settingsStyles.dialogForm}>
            <TextField
              label="Name"
              value={name}
              onChange={(e) => {
                setName((e.target as HTMLInputElement).value);
                if (createErrors.name) {
                  setCreateErrors((prev) => {
                    const next = { ...prev };
                    delete next.name;
                    return next;
                  });
                }
              }}
              error={!!createErrors.name}
              helperText={createErrors.name || 'A descriptive name for this key (e.g. "CI/CD pipeline")'}
              required
              fullWidth
            />

            <DatePicker
              label="Expires"
              value={expiresAt}
              onChange={(date) => {
                setExpiresAt(date);
                if (createErrors.expiresAt) {
                  setCreateErrors((prev) => {
                    const next = { ...prev };
                    delete next.expiresAt;
                    return next;
                  });
                }
              }}
              minDate={new Date()}
              maxDate={maxDate}
              placeholderText="Select expiry date"
              error={!!createErrors.expiresAt}
              helperText={createErrors.expiresAt || 'Maximum 1 year from today'}
            />

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 500 }}>Scopes</span>
                {createErrors.scopes && (
                  <span style={{ color: 'var(--color-error, #d32f2f)', fontSize: '0.75rem' }}>
                    {createErrors.scopes}
                  </span>
                )}
              </div>
              <div className={styles.scopeGrid}>
                {SCOPE_GROUPS.map((group) => {
                  const readScope = `${group.resource}:read` as ApiKeyScope;
                  const writeScope = group.hasWrite ? (`${group.resource}:write` as ApiKeyScope) : null;

                  return (
                    <React.Fragment key={group.resource}>
                      <span className={styles.scopeGroupLabel}>{group.label}</span>
                      <label className={styles.scopeCheckbox}>
                        <input
                          type="checkbox"
                          checked={scopes.includes(readScope)}
                          onChange={() => handleToggleScope(readScope)}
                        />
                        Read
                      </label>
                      {writeScope && (
                        <label className={styles.scopeCheckbox}>
                          <input
                            type="checkbox"
                            checked={scopes.includes(writeScope)}
                            onChange={() => handleToggleScope(writeScope)}
                          />
                          Write
                        </label>
                      )}
                      {!writeScope && <span />}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        </Dialog.Content>
        <Dialog.Actions>
          <Button variant="secondary" onClick={handleCloseCreate} disabled={createLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={createLoading}
            loading={createLoading}
            startIcon={!createLoading ? <Key size={18} /> : undefined}
          >
            Create Key
          </Button>
        </Dialog.Actions>
      </Dialog>

      <Dialog open={revealOpen} onClose={() => setRevealOpen(false)} disableBackdropClose={true} size="medium">
        <Dialog.Title>Your New API Key</Dialog.Title>
        <Dialog.Content>
          <div className={styles.warningBanner}>
            <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Copy this key now — it will not be shown again. Store it somewhere safe.
            </span>
          </div>
          <TextField
            value={rawKey}
            readOnly
            fullWidth
            style={{ fontFamily: 'monospace' }}
            endAdornment={
              <button
                type="button"
                className={styles.copyButton}
                onClick={handleCopyKey}
                title="Copy to clipboard"
              >
                <Copy size={18} />
              </button>
            }
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button variant="primary" onClick={() => setRevealOpen(false)}>
            I've copied it
          </Button>
        </Dialog.Actions>
      </Dialog>

      <ConfirmDialog
        open={revokeOpen}
        title="Revoke API Key"
        message={`Are you sure you want to revoke "${keyToRevoke?.name}"? This cannot be undone and any integrations using this key will stop working.`}
        severity="danger"
        confirmLabel="Revoke Key"
        onConfirm={handleRevoke}
        onCancel={handleRevokeCancel}
      />
    </>
  );
};
