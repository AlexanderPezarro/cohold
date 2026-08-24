import { describe, it, expect } from '@jest/globals';
import {
  TransactionTypeSchema,
  IncomeCategorySchema,
  ExpenseCategorySchema,
  TransactionCategorySchema,
  CreateTransactionSchema,
  UpdateTransactionSchema,
  TransactionSchema,
  TransactionWithSplitsSchema,
} from '../transaction.validation';

const propertyId = '123e4567-e89b-12d3-a456-426614174000';
const leaseId = '123e4567-e89b-12d3-a456-426614174001';
const transactionId = '123e4567-e89b-12d3-a456-426614174002';
const userId = '123e4567-e89b-12d3-a456-426614174003';

const baseIncome = {
  propertyId,
  type: 'Income' as const,
  category: 'Rent' as const,
  amount: 1200,
  transactionDate: new Date('2024-01-01'),
  description: 'Monthly rent payment',
};

const baseExpense = {
  propertyId,
  type: 'Expense' as const,
  category: 'Maintenance' as const,
  amount: 150,
  transactionDate: new Date('2024-01-01'),
  description: 'Boiler repair',
};

describe('TransactionTypeSchema', () => {
  it('accepts Income and Expense', () => {
    expect(TransactionTypeSchema.parse('Income')).toBe('Income');
    expect(TransactionTypeSchema.parse('Expense')).toBe('Expense');
  });

  it('rejects an unknown type', () => {
    expect(() => TransactionTypeSchema.parse('Refund')).toThrow();
  });
});

describe('IncomeCategorySchema', () => {
  it('accepts each valid income category', () => {
    for (const category of ['Rent', 'Security Deposit', 'Late Fee', 'Lease Fee']) {
      expect(IncomeCategorySchema.parse(category)).toBe(category);
    }
  });

  it('rejects an expense category', () => {
    expect(() => IncomeCategorySchema.parse('Maintenance')).toThrow();
  });
});

describe('ExpenseCategorySchema', () => {
  it('accepts each valid expense category', () => {
    for (const category of [
      'Maintenance',
      'Repair',
      'Utilities',
      'Insurance',
      'Council Tax',
      'Ground Rent',
      'Service Charge',
      'Management Fee',
      'Legal Fee',
      'Transport',
      'Other',
    ]) {
      expect(ExpenseCategorySchema.parse(category)).toBe(category);
    }
  });

  it('rejects an income category', () => {
    expect(() => ExpenseCategorySchema.parse('Rent')).toThrow();
  });
});

describe('TransactionCategorySchema', () => {
  it('accepts income categories', () => {
    expect(TransactionCategorySchema.parse('Rent')).toBe('Rent');
  });

  it('accepts expense categories', () => {
    expect(TransactionCategorySchema.parse('Maintenance')).toBe('Maintenance');
  });

  it('rejects a category outside both unions', () => {
    expect(() => TransactionCategorySchema.parse('Not A Category')).toThrow();
  });
});

describe('CreateTransactionSchema', () => {
  it('accepts a valid Income transaction with an income category', () => {
    expect(() => CreateTransactionSchema.parse(baseIncome)).not.toThrow();
  });

  it('accepts a valid Expense transaction with an expense category', () => {
    expect(() => CreateTransactionSchema.parse(baseExpense)).not.toThrow();
  });

  it('rejects an Income transaction with an expense category', () => {
    expect(() =>
      CreateTransactionSchema.parse({ ...baseIncome, category: 'Maintenance' })
    ).toThrow();
  });

  it('rejects an Expense transaction with an income category', () => {
    expect(() => CreateTransactionSchema.parse({ ...baseExpense, category: 'Rent' })).toThrow();
  });

  it('rejects a non-positive amount', () => {
    expect(() => CreateTransactionSchema.parse({ ...baseIncome, amount: 0 })).toThrow();
  });

  it('rejects an empty description', () => {
    expect(() => CreateTransactionSchema.parse({ ...baseIncome, description: '' })).toThrow();
  });

  it('accepts an optional leaseId', () => {
    expect(() => CreateTransactionSchema.parse({ ...baseIncome, leaseId })).not.toThrow();
  });

  it('accepts a null leaseId', () => {
    expect(() => CreateTransactionSchema.parse({ ...baseIncome, leaseId: null })).not.toThrow();
  });

  it('rejects an invalid propertyId', () => {
    expect(() =>
      CreateTransactionSchema.parse({ ...baseIncome, propertyId: 'not-a-uuid' })
    ).toThrow();
  });
});

describe('UpdateTransactionSchema', () => {
  it('accepts an update with only id (no type/category refinement needed)', () => {
    expect(() => UpdateTransactionSchema.parse({ id: transactionId })).not.toThrow();
  });

  it('accepts an update with type but no category (refinement skipped)', () => {
    expect(() =>
      UpdateTransactionSchema.parse({ id: transactionId, type: 'Income' })
    ).not.toThrow();
  });

  it('accepts an update with category but no type (refinement skipped)', () => {
    expect(() =>
      UpdateTransactionSchema.parse({ id: transactionId, category: 'Rent' })
    ).not.toThrow();
  });

  it('accepts a valid Income type+category pair', () => {
    expect(() =>
      UpdateTransactionSchema.parse({ id: transactionId, type: 'Income', category: 'Rent' })
    ).not.toThrow();
  });

  it('accepts a valid Expense type+category pair', () => {
    expect(() =>
      UpdateTransactionSchema.parse({
        id: transactionId,
        type: 'Expense',
        category: 'Maintenance',
      })
    ).not.toThrow();
  });

  it('rejects an Income type with an expense category', () => {
    expect(() =>
      UpdateTransactionSchema.parse({
        id: transactionId,
        type: 'Income',
        category: 'Maintenance',
      })
    ).toThrow();
  });

  it('rejects an Expense type with an income category', () => {
    expect(() =>
      UpdateTransactionSchema.parse({ id: transactionId, type: 'Expense', category: 'Rent' })
    ).toThrow();
  });

  it('rejects an invalid id', () => {
    expect(() => UpdateTransactionSchema.parse({ id: 'not-a-uuid' })).toThrow();
  });
});

describe('TransactionSchema', () => {
  const full = {
    id: transactionId,
    ...baseIncome,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('accepts a valid full Income transaction', () => {
    expect(() => TransactionSchema.parse(full)).not.toThrow();
  });

  it('accepts a valid full Expense transaction', () => {
    expect(() =>
      TransactionSchema.parse({
        id: transactionId,
        ...baseExpense,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).not.toThrow();
  });

  it('rejects a mismatched Income/expense-category pair', () => {
    expect(() => TransactionSchema.parse({ ...full, category: 'Maintenance' })).toThrow();
  });

  it('rejects a mismatched Expense/income-category pair', () => {
    expect(() =>
      TransactionSchema.parse({
        id: transactionId,
        ...baseExpense,
        category: 'Rent',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).toThrow();
  });
});

describe('TransactionWithSplitsSchema', () => {
  const validSplits = [
    { userId, percentage: 60, amount: 720 },
    { userId: transactionId, percentage: 40, amount: 480 },
  ];

  it('accepts a valid Income transaction with splits', () => {
    expect(() =>
      TransactionWithSplitsSchema.parse({
        ...baseIncome,
        paidByUserId: userId,
        splits: validSplits,
      })
    ).not.toThrow();
  });

  it('accepts a valid Expense transaction with splits', () => {
    expect(() =>
      TransactionWithSplitsSchema.parse({
        ...baseExpense,
        paidByUserId: userId,
        splits: validSplits,
      })
    ).not.toThrow();
  });

  it('accepts a transaction without splits (optional)', () => {
    expect(() => TransactionWithSplitsSchema.parse(baseIncome)).not.toThrow();
  });

  it('rejects an Income transaction with an expense category', () => {
    expect(() =>
      TransactionWithSplitsSchema.parse({ ...baseIncome, category: 'Maintenance' })
    ).toThrow();
  });

  it('rejects an Expense transaction with an income category', () => {
    expect(() =>
      TransactionWithSplitsSchema.parse({ ...baseExpense, category: 'Rent' })
    ).toThrow();
  });

  it('accepts a null paidByUserId', () => {
    expect(() =>
      TransactionWithSplitsSchema.parse({ ...baseIncome, paidByUserId: null })
    ).not.toThrow();
  });
});
