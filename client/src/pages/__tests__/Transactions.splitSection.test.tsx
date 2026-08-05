import { TextEncoder, TextDecoder } from 'util';

if (typeof globalThis.TextEncoder === 'undefined') {
  // react-router-dom expects these Node globals, which jsdom does not provide.
  (globalThis as any).TextEncoder = TextEncoder;
  (globalThis as any).TextDecoder = TextDecoder;
}

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Transactions } from '../Transactions';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useProperties } from '../../contexts/PropertiesContext';
import { transactionsService } from '../../services/api/transactions.service';
import { propertyOwnershipService } from '../../services/api/propertyOwnership.service';
import type { Transaction } from '../../types/api.types';

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../contexts/ToastContext', () => ({
  useToast: jest.fn(),
}));

jest.mock('../../contexts/PropertiesContext', () => ({
  useProperties: jest.fn(),
}));

jest.mock('../../services/api/transactions.service', () => ({
  transactionsService: {
    getTransactions: jest.fn(),
    getTransactionSummary: jest.fn(),
    createTransaction: jest.fn(),
    updateTransaction: jest.fn(),
    deleteTransaction: jest.fn(),
  },
}));

jest.mock('../../services/api/propertyOwnership.service', () => ({
  propertyOwnershipService: {
    listOwners: jest.fn(),
  },
}));

jest.mock('../../services/api/documents.service', () => ({
  documentsService: {
    uploadDocument: jest.fn(),
  },
}));

const mockUseAuth = useAuth as jest.Mock;
const mockUseToast = useToast as jest.Mock;
const mockUseProperties = useProperties as jest.Mock;
const mockGetTransactions = transactionsService.getTransactions as jest.Mock;
const mockGetTransactionSummary = transactionsService.getTransactionSummary as jest.Mock;
const mockListOwners = propertyOwnershipService.listOwners as jest.Mock;

const PROPERTY_ID = 'prop-1';

const ownerships = [
  {
    id: 'own-1',
    userId: 'user-1',
    propertyId: PROPERTY_ID,
    ownershipPercentage: 60,
    user: { id: 'user-1', email: 'alice@example.com', role: 'LANDLORD' as const },
  },
  {
    id: 'own-2',
    userId: 'user-2',
    propertyId: PROPERTY_ID,
    ownershipPercentage: 40,
    user: { id: 'user-2', email: 'bob@example.com', role: 'LANDLORD' as const },
  },
];

// A transaction that already has splits saved (e.g. created after ownership was set up).
const transactionWithSplits: Transaction = {
  id: 'txn-with-splits',
  propertyId: PROPERTY_ID,
  type: 'Expense',
  category: 'Maintenance',
  amount: 100,
  transactionDate: '2026-01-01T00:00:00.000Z',
  description: 'Boiler service',
  paidByUserId: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  splits: [
    { userId: 'user-1', percentage: 60, amount: 60 },
    { userId: 'user-2', percentage: 40, amount: 40 },
  ],
};

// A transaction for the SAME property that was created before ownership/splits
// existed, so it has no saved splits.
const transactionWithoutSplits: Transaction = {
  id: 'txn-without-splits',
  propertyId: PROPERTY_ID,
  type: 'Expense',
  category: 'Repair',
  amount: 50,
  transactionDate: '2026-01-02T00:00:00.000Z',
  description: 'Gutter repair',
  paidByUserId: null,
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  splits: [],
};

describe('Transactions split section', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'alice@example.com', role: 'LANDLORD' },
      isAuthenticated: true,
      isLoading: false,
      isAdmin: () => false,
      canWrite: () => true,
      login: jest.fn(),
      logout: jest.fn(),
      checkAuth: jest.fn(),
    });

    mockUseToast.mockReturnValue({
      showToast: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
      warning: jest.fn(),
      info: jest.fn(),
    });

    mockUseProperties.mockReturnValue({
      properties: [
        {
          id: PROPERTY_ID,
          name: 'Test Property',
          street: '1 Test Street',
          city: 'Testville',
          county: 'Testshire',
          postcode: 'AB1 2CD',
          propertyType: 'House',
          status: 'Available',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    mockGetTransactions.mockResolvedValue([
      transactionWithSplits,
      transactionWithoutSplits,
    ]);
    mockGetTransactionSummary.mockResolvedValue({
      total_income: 0,
      total_expense: 150,
      net: -150,
    });
    mockListOwners.mockResolvedValue(ownerships);
  });

  it('auto-populates splits from ownership when editing a same-property transaction that has none saved', async () => {
    const user = userEvent.setup();
    render(<Transactions />);

    // Wait for the transaction list to load.
    await screen.findByText('Showing 2 transactions');

    const editButtons = screen.getAllByLabelText('Edit transaction');

    // Edit the transaction that already has splits first. This sets
    // formData.propertyId to PROPERTY_ID.
    await user.click(editButtons[0]);
    await waitFor(() => expect(mockListOwners).toHaveBeenCalledWith(PROPERTY_ID));

    let dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByText('Transaction Splits'));
    expect(within(dialog).queryByText(/Split percentages must sum to 100%/)).toBeNull();

    // Close the dialog without saving.
    await user.click(within(dialog).getByText('Cancel'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    mockListOwners.mockClear();

    // Now edit the second transaction for the SAME property, which has no
    // saved splits. Because formData.propertyId doesn't change (it's still
    // PROPERTY_ID from the previous edit), the ownership-loading effect
    // never re-fires, and splits are never backfilled from the
    // already-loaded ownership data.
    await user.click(editButtons[1]);

    dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByText('Transaction Splits'));

    // The property IS selected and DOES have ownership configured, so the
    // split section should show the 60/40 default split, not an error.
    await waitFor(() => {
      expect(
        within(dialog).queryByText(/Select a property with ownership configured/)
      ).toBeNull();
    });
    expect(within(dialog).queryByText(/Split percentages must sum to 100%/)).toBeNull();
    expect(within(dialog).getByText('Total: 100.00%')).not.toBeNull();
  });
});
