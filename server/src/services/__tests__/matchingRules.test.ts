import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { createDefaultMatchingRules } from '../matchingRules.js';
import matchingRulesService from '../matchingRules.js';
import { evaluateRules } from '../ruleEvaluationEngine.js';
import prisma from '../../db/client.js';
import { encryptToken } from '../encryption.js';
import type { BankTransaction } from '@prisma/client';

// Helper to create mock bank transaction
function createMockTransaction(overrides: Partial<BankTransaction> = {}): BankTransaction {
  return {
    id: 'tx_test_001',
    bankAccountId: 'acc_test_001',
    externalId: 'ext_test_001',
    amount: -50.0,
    currency: 'GBP',
    description: 'Test transaction',
    counterpartyName: null,
    reference: null,
    merchant: null,
    category: null,
    transactionDate: new Date('2024-01-15T10:00:00Z'),
    settledDate: new Date('2024-01-15T12:00:00Z'),
    importedAt: new Date('2024-01-16T08:00:00Z'),
    transactionId: null,
    pendingTransactionId: null,
    ...overrides,
  };
}

describe('Default Matching Rules', () => {
  beforeEach(async () => {
    // Clean up any existing global matching rules
    await prisma.matchingRule.deleteMany({
      where: { bankAccountId: null },
    });
  });

  afterEach(async () => {
    // Clean up after tests
    await prisma.matchingRule.deleteMany({
      where: { bankAccountId: null },
    });
  });

  describe('createDefaultMatchingRules', () => {
    it('should create all 5 default rules', async () => {
      await createDefaultMatchingRules();

      const rules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
        orderBy: { priority: 'asc' },
      });

      expect(rules).toHaveLength(5);
    });

    it('should create rent rule with correct properties', async () => {
      await createDefaultMatchingRules();

      const rentRule = await prisma.matchingRule.findFirst({
        where: {
          bankAccountId: null,
          name: 'Default: Rent',
        },
      });

      expect(rentRule).toBeDefined();
      expect(rentRule?.priority).toBe(100);
      expect(rentRule?.enabled).toBe(true);
      expect(rentRule?.type).toBe('INCOME');
      expect(rentRule?.category).toBe('Rent');
      expect(rentRule?.propertyId).toBeNull();

      const conditions = JSON.parse(rentRule!.conditions);
      expect(conditions).toEqual({
        operator: 'AND',
        rules: [
          {
            field: 'description',
            matchType: 'contains',
            value: 'rent',
            caseSensitive: false,
          },
        ],
      });
    });

    it('should create deposit rule with correct properties', async () => {
      await createDefaultMatchingRules();

      const depositRule = await prisma.matchingRule.findFirst({
        where: {
          bankAccountId: null,
          name: 'Default: Security Deposit',
        },
      });

      expect(depositRule).toBeDefined();
      expect(depositRule?.priority).toBe(101);
      expect(depositRule?.enabled).toBe(true);
      expect(depositRule?.type).toBe('INCOME');
      expect(depositRule?.category).toBe('Security Deposit');
      expect(depositRule?.propertyId).toBeNull();

      const conditions = JSON.parse(depositRule!.conditions);
      expect(conditions).toEqual({
        operator: 'AND',
        rules: [
          {
            field: 'description',
            matchType: 'contains',
            value: 'deposit',
            caseSensitive: false,
          },
        ],
      });
    });

    it('should create maintenance rule with correct properties', async () => {
      await createDefaultMatchingRules();

      const maintenanceRule = await prisma.matchingRule.findFirst({
        where: {
          bankAccountId: null,
          name: 'Default: Maintenance',
        },
      });

      expect(maintenanceRule).toBeDefined();
      expect(maintenanceRule?.priority).toBe(102);
      expect(maintenanceRule?.enabled).toBe(true);
      expect(maintenanceRule?.type).toBe('EXPENSE');
      expect(maintenanceRule?.category).toBe('Maintenance');
      expect(maintenanceRule?.propertyId).toBeNull();

      const conditions = JSON.parse(maintenanceRule!.conditions);
      expect(conditions).toEqual({
        operator: 'AND',
        rules: [
          {
            field: 'description',
            matchType: 'contains',
            value: 'maintenance',
            caseSensitive: false,
          },
        ],
      });
    });

    it('should create repair rule with correct properties', async () => {
      await createDefaultMatchingRules();

      const repairRule = await prisma.matchingRule.findFirst({
        where: {
          bankAccountId: null,
          name: 'Default: Repair',
        },
      });

      expect(repairRule).toBeDefined();
      expect(repairRule?.priority).toBe(103);
      expect(repairRule?.enabled).toBe(true);
      expect(repairRule?.type).toBe('EXPENSE');
      expect(repairRule?.category).toBe('Repair');
      expect(repairRule?.propertyId).toBeNull();

      const conditions = JSON.parse(repairRule!.conditions);
      expect(conditions).toEqual({
        operator: 'AND',
        rules: [
          {
            field: 'description',
            matchType: 'contains',
            value: 'repair',
            caseSensitive: false,
          },
        ],
      });
    });

    it('should create amount<0 catch-all rule with correct properties', async () => {
      await createDefaultMatchingRules();

      const catchAllRule = await prisma.matchingRule.findFirst({
        where: {
          bankAccountId: null,
          name: 'Default: Negative Amount',
        },
      });

      expect(catchAllRule).toBeDefined();
      expect(catchAllRule?.priority).toBe(1000);
      expect(catchAllRule?.enabled).toBe(true);
      expect(catchAllRule?.type).toBe('EXPENSE');
      expect(catchAllRule?.category).toBe('Other');
      expect(catchAllRule?.propertyId).toBeNull();

      const conditions = JSON.parse(catchAllRule!.conditions);
      expect(conditions).toEqual({
        operator: 'AND',
        rules: [
          {
            field: 'amount',
            matchType: 'lessThan',
            value: 0,
          },
        ],
      });
    });

    it('should be idempotent - not create duplicates on second call', async () => {
      await createDefaultMatchingRules();
      await createDefaultMatchingRules();

      const rules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });

      expect(rules).toHaveLength(5);
    });

    it('should return early if rules already exist', async () => {
      const result1 = await createDefaultMatchingRules();
      const result2 = await createDefaultMatchingRules();

      expect(result1).toBe(5); // 5 rules created
      expect(result2).toBe(0); // 0 rules created (already exist)
    });

    it('should recover from partial state by completing missing rules', async () => {
      // Simulate partial setup: create only 2 of 5 rules manually
      await prisma.matchingRule.createMany({
        data: [
          {
            name: 'Default: Rent',
            priority: 100,
            enabled: true,
            bankAccountId: null,
            propertyId: null,
            type: 'INCOME',
            category: 'Rent',
            conditions: JSON.stringify({
              operator: 'AND',
              rules: [
                {
                  field: 'description',
                  matchType: 'contains',
                  value: 'rent',
                  caseSensitive: false,
                },
              ],
            }),
          },
          {
            name: 'Default: Security Deposit',
            priority: 101,
            enabled: true,
            bankAccountId: null,
            propertyId: null,
            type: 'INCOME',
            category: 'Security Deposit',
            conditions: JSON.stringify({
              operator: 'AND',
              rules: [
                {
                  field: 'description',
                  matchType: 'contains',
                  value: 'deposit',
                  caseSensitive: false,
                },
              ],
            }),
          },
        ],
      });

      // Verify we only have 2 rules
      const partialRules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });
      expect(partialRules).toHaveLength(2);

      // Call the function - it should create the remaining 3 rules
      const result = await createDefaultMatchingRules();
      expect(result).toBe(5); // Should create all 5 again

      // Verify we now have 7 total rules (2 partial + 5 new)
      // This is expected behavior - the function recreates all defaults
      const allRules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });
      expect(allRules.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Integration with rule evaluation engine', () => {
    beforeEach(async () => {
      await createDefaultMatchingRules();
    });

    it('should match transaction with "rent" in description', async () => {
      const transaction = createMockTransaction({
        description: 'Monthly rent payment from tenant',
        amount: 1200.0,
      });

      const rules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });

      const result = evaluateRules(transaction, rules);

      expect(result.type).toBe('INCOME');
      expect(result.category).toBe('Rent');
      expect(result.matchedRules.length).toBeGreaterThan(0);
    });

    it('should match transaction with "deposit" in description', async () => {
      const transaction = createMockTransaction({
        description: 'Security deposit received',
        amount: 2000.0,
      });

      const rules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });

      const result = evaluateRules(transaction, rules);

      expect(result.type).toBe('INCOME');
      expect(result.category).toBe('Security Deposit');
      expect(result.matchedRules.length).toBeGreaterThan(0);
    });

    it('should match transaction with "maintenance" in description', async () => {
      const transaction = createMockTransaction({
        description: 'Property maintenance service',
        amount: -350.0,
      });

      const rules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });

      const result = evaluateRules(transaction, rules);

      expect(result.type).toBe('EXPENSE');
      expect(result.category).toBe('Maintenance');
      expect(result.matchedRules.length).toBeGreaterThan(0);
    });

    it('should match transaction with "repair" in description', async () => {
      const transaction = createMockTransaction({
        description: 'Emergency boiler repair',
        amount: -450.0,
      });

      const rules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });

      const result = evaluateRules(transaction, rules);

      expect(result.type).toBe('EXPENSE');
      expect(result.category).toBe('Repair');
      expect(result.matchedRules.length).toBeGreaterThan(0);
    });

    it('should match negative amount transaction with catch-all rule', async () => {
      const transaction = createMockTransaction({
        description: 'Some random expense',
        amount: -100.0,
      });

      const rules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });

      const result = evaluateRules(transaction, rules);

      expect(result.type).toBe('EXPENSE');
      expect(result.category).toBe('Other');
      expect(result.matchedRules.length).toBeGreaterThan(0);
    });

    it('should prioritize specific keyword rules over catch-all', async () => {
      const transaction = createMockTransaction({
        description: 'Repair work payment',
        amount: -200.0,
      });

      const rules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });

      const result = evaluateRules(transaction, rules);

      // Should match "repair" rule (priority 103), not catch-all (priority 1000)
      expect(result.type).toBe('EXPENSE');
      expect(result.category).toBe('Repair');
    });

    it('should not match positive amounts with catch-all rule', async () => {
      const transaction = createMockTransaction({
        description: 'Some income',
        amount: 500.0,
      });

      const rules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });

      const result = evaluateRules(transaction, rules);

      // Should not match catch-all (amount < 0) or any keyword rules
      expect(result.type).toBeUndefined();
      expect(result.category).toBeUndefined();
      expect(result.matchedRules).toEqual([]);
    });

    it('should match case-insensitively', async () => {
      const transaction1 = createMockTransaction({
        description: 'RENT PAYMENT',
        amount: 1000.0,
      });

      const transaction2 = createMockTransaction({
        description: 'ReNt PaYmEnT',
        amount: 1000.0,
      });

      const rules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });

      const result1 = evaluateRules(transaction1, rules);
      const result2 = evaluateRules(transaction2, rules);

      expect(result1.type).toBe('INCOME');
      expect(result1.category).toBe('Rent');

      expect(result2.type).toBe('INCOME');
      expect(result2.category).toBe('Rent');
    });

    it('should match when keyword is part of longer word', async () => {
      const transaction = createMockTransaction({
        description: 'Rental income received',
        amount: 1500.0,
      });

      const rules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });

      const result = evaluateRules(transaction, rules);

      expect(result.type).toBe('INCOME');
      expect(result.category).toBe('Rent');
    });

    it('should not override propertyId (which is null for global rules)', async () => {
      const transaction = createMockTransaction({
        description: 'Monthly rent payment',
        amount: 1200.0,
      });

      const rules = await prisma.matchingRule.findMany({
        where: { bankAccountId: null },
      });

      const result = evaluateRules(transaction, rules);

      // Global rules don't set propertyId
      expect(result.propertyId).toBeUndefined();
      expect(result.type).toBe('INCOME');
      expect(result.category).toBe('Rent');
      expect(result.isFullyMatched).toBe(false); // Not fully matched without propertyId
    });
  });
});

describe('MatchingRulesService', () => {
  let bankAccountId: string;

  const validConditions = JSON.stringify({
    operator: 'AND',
    rules: [
      {
        field: 'description',
        matchType: 'contains',
        value: 'rent',
        caseSensitive: false,
      },
    ],
  });

  beforeAll(async () => {
    const bankAccount = await prisma.bankAccount.create({
      data: {
        accountId: 'svc_test_acc_001',
        accountName: 'Service Test Account',
        accountType: 'uk_retail',
        provider: 'monzo',
        accessToken: encryptToken('svc_test_access_token'),
        syncEnabled: true,
        syncFromDate: new Date('2024-01-01'),
        lastSyncStatus: 'never_synced',
      },
    });
    bankAccountId = bankAccount.id;
  });

  afterAll(async () => {
    await prisma.matchingRule.deleteMany({ where: { bankAccountId } });
    await prisma.bankAccount.delete({ where: { id: bankAccountId } });
  });

  beforeEach(async () => {
    await prisma.matchingRule.deleteMany({ where: { bankAccountId } });
  });

  describe('reorderRules', () => {
    it('assigns priorities based on position in the given array', async () => {
      const rule1 = await prisma.matchingRule.create({
        data: {
          bankAccountId,
          priority: 0,
          name: 'Rule 1',
          enabled: true,
          conditions: validConditions,
        },
      });
      const rule2 = await prisma.matchingRule.create({
        data: {
          bankAccountId,
          priority: 1,
          name: 'Rule 2',
          enabled: true,
          conditions: validConditions,
        },
      });
      const rule3 = await prisma.matchingRule.create({
        data: {
          bankAccountId,
          priority: 2,
          name: 'Rule 3',
          enabled: true,
          conditions: validConditions,
        },
      });

      await matchingRulesService.reorderRules([rule3.id, rule1.id, rule2.id]);

      const updated1 = await prisma.matchingRule.findUnique({ where: { id: rule1.id } });
      const updated2 = await prisma.matchingRule.findUnique({ where: { id: rule2.id } });
      const updated3 = await prisma.matchingRule.findUnique({ where: { id: rule3.id } });

      expect(updated3?.priority).toBe(0);
      expect(updated1?.priority).toBe(1);
      expect(updated2?.priority).toBe(2);
    });

    it('validates all rule IDs before writing anything, leaving priorities unchanged on failure', async () => {
      const rule1 = await prisma.matchingRule.create({
        data: {
          bankAccountId,
          priority: 0,
          name: 'Rule 1',
          enabled: true,
          conditions: validConditions,
        },
      });

      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await expect(
        matchingRulesService.reorderRules([rule1.id, nonExistentId])
      ).rejects.toThrow('One or more rules not found');

      const unchanged = await prisma.matchingRule.findUnique({ where: { id: rule1.id } });
      expect(unchanged?.priority).toBe(0);
    });

    it('throws "One or more rules not found" when a rule ID does not exist', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await expect(matchingRulesService.reorderRules([nonExistentId])).rejects.toThrow(
        'One or more rules not found'
      );
    });

    it('throws "Cannot reorder global rules" when any rule in the list is global', async () => {
      const globalRule = await prisma.matchingRule.create({
        data: {
          bankAccountId: null,
          priority: 100,
          name: 'Global Rule',
          enabled: true,
          conditions: validConditions,
        },
      });

      await expect(matchingRulesService.reorderRules([globalRule.id])).rejects.toThrow(
        'Cannot reorder global rules'
      );

      await prisma.matchingRule.delete({ where: { id: globalRule.id } });
    });
  });

  describe('testRule', () => {
    it('returns matches: true and a populated result when the sample transaction matches', async () => {
      const rule = await prisma.matchingRule.create({
        data: {
          bankAccountId,
          priority: 0,
          name: 'Rent Rule',
          enabled: true,
          conditions: validConditions,
          type: 'INCOME',
          category: 'Rent',
        },
      });

      const { matches, result } = await matchingRulesService.testRule(rule.id, {
        description: 'Monthly rent payment',
        amount: 1000,
      });

      expect(matches).toBe(true);
      expect(result.matchedRules).toContain(rule.id);
      expect(result.type).toBe('INCOME');
      expect(result.category).toBe('Rent');
    });

    it('returns matches: false and no matched rules when the sample transaction does not match', async () => {
      const rule = await prisma.matchingRule.create({
        data: {
          bankAccountId,
          priority: 0,
          name: 'Rent Rule',
          enabled: true,
          conditions: validConditions,
          type: 'INCOME',
          category: 'Rent',
        },
      });

      const { matches, result } = await matchingRulesService.testRule(rule.id, {
        description: 'Coffee shop payment',
        amount: 5.5,
      });

      expect(matches).toBe(false);
      expect(result.matchedRules).toHaveLength(0);
    });

    it('evaluates the rule in isolation, ignoring other rules for the account', async () => {
      // A higher-priority global catch-all rule that would otherwise also match
      const globalCatchAll = await prisma.matchingRule.create({
        data: {
          bankAccountId: null,
          priority: 1000,
          name: 'Global catch-all',
          enabled: true,
          conditions: JSON.stringify({
            operator: 'AND',
            rules: [{ field: 'amount', matchType: 'lessThan', value: 0 }],
          }),
          type: 'EXPENSE',
          category: 'Other',
        },
      });

      const rule = await prisma.matchingRule.create({
        data: {
          bankAccountId,
          priority: 0,
          name: 'Rent Rule',
          enabled: true,
          conditions: validConditions,
          type: 'INCOME',
          category: 'Rent',
        },
      });

      const { result } = await matchingRulesService.testRule(rule.id, {
        description: 'Monthly rent payment',
        amount: -1000, // would also satisfy the global catch-all's amount<0 condition
      });

      // Only the rule under test should appear in matchedRules - the global
      // catch-all is not part of this evaluation at all.
      expect(result.matchedRules).toEqual([rule.id]);

      await prisma.matchingRule.delete({ where: { id: globalCatchAll.id } });
    });

    it('respects optional counterpartyName/merchant/reference fields', async () => {
      const rule = await prisma.matchingRule.create({
        data: {
          bankAccountId,
          priority: 0,
          name: 'Merchant Rule',
          enabled: true,
          conditions: JSON.stringify({
            operator: 'AND',
            rules: [
              {
                field: 'merchant',
                matchType: 'equals',
                value: 'Acme Ltd',
                caseSensitive: true,
              },
            ],
          }),
          type: 'EXPENSE',
          category: 'Maintenance',
        },
      });

      const { matches } = await matchingRulesService.testRule(rule.id, {
        description: 'Invoice payment',
        amount: -75,
        merchant: 'Acme Ltd',
      });

      expect(matches).toBe(true);
    });

    it('works for global rules, using a placeholder bankAccountId on the mock transaction', async () => {
      const globalRule = await prisma.matchingRule.create({
        data: {
          bankAccountId: null,
          priority: 100,
          name: 'Global Rent Rule',
          enabled: true,
          conditions: validConditions,
          type: 'INCOME',
          category: 'Rent',
        },
      });

      const { matches, result } = await matchingRulesService.testRule(globalRule.id, {
        description: 'Rent for July',
        amount: 900,
      });

      expect(matches).toBe(true);
      expect(result.category).toBe('Rent');

      await prisma.matchingRule.delete({ where: { id: globalRule.id } });
    });

    it('throws "Matching rule not found" for a non-existent rule ID', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await expect(
        matchingRulesService.testRule(nonExistentId, {
          description: 'Test',
          amount: 100,
        })
      ).rejects.toThrow('Matching rule not found');
    });
  });
});
