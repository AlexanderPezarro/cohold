import prisma from '../db/client.js';
import { evaluateRules, RuleEvaluationResult } from './ruleEvaluationEngine.js';
import { reprocessPendingTransactions, ReprocessingResult } from './ruleReprocessing.js';
import type { BankTransaction, MatchingRule } from '@prisma/client';
import type {
  CreateMatchingRule,
  UpdateMatchingRule,
  TestRule,
} from '../../../shared/validation/matchingRule.validation.js';

/**
 * Create default global matching rules for bank transaction categorization
 *
 * This function creates 5 sensible default rules:
 * 1. rent → Income/Rent (priority 100)
 * 2. deposit → Income/Security Deposit (priority 101)
 * 3. maintenance → Expense/Maintenance (priority 102)
 * 4. repair → Expense/Repair (priority 103)
 * 5. amount<0 → Expense/Other (priority 1000, catch-all)
 *
 * Rules are global (bankAccountId = null) and apply as fallback defaults
 * to all bank accounts.
 *
 * This function is idempotent - it will check if default rules already exist
 * and return early if they do.
 *
 * @returns The number of rules created (0 if they already exist, 5 if created)
 */
export async function createDefaultMatchingRules(): Promise<number> {
  // Check if default rules already exist
  const existingRules = await prisma.matchingRule.findMany({
    where: {
      bankAccountId: null,
      name: {
        startsWith: 'Default:',
      },
    },
  });

  // If all default rules exist, return early
  if (existingRules.length >= 5) {
    return 0;
  }

  // Define the default rules
  const defaultRules = [
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
    {
      name: 'Default: Maintenance',
      priority: 102,
      enabled: true,
      bankAccountId: null,
      propertyId: null,
      type: 'EXPENSE',
      category: 'Maintenance',
      conditions: JSON.stringify({
        operator: 'AND',
        rules: [
          {
            field: 'description',
            matchType: 'contains',
            value: 'maintenance',
            caseSensitive: false,
          },
        ],
      }),
    },
    {
      name: 'Default: Repair',
      priority: 103,
      enabled: true,
      bankAccountId: null,
      propertyId: null,
      type: 'EXPENSE',
      category: 'Repair',
      conditions: JSON.stringify({
        operator: 'AND',
        rules: [
          {
            field: 'description',
            matchType: 'contains',
            value: 'repair',
            caseSensitive: false,
          },
        ],
      }),
    },
    {
      name: 'Default: Negative Amount',
      priority: 1000,
      enabled: true,
      bankAccountId: null,
      propertyId: null,
      type: 'EXPENSE',
      category: 'Other',
      conditions: JSON.stringify({
        operator: 'AND',
        rules: [
          {
            field: 'amount',
            matchType: 'lessThan',
            value: 0,
          },
        ],
      }),
    },
  ];

  // Create all default rules
  await prisma.matchingRule.createMany({
    data: defaultRules,
  });

  return defaultRules.length;
}

/**
 * Result of a rule create/update/delete operation that also triggers
 * reprocessing of affected pending transactions.
 */
export interface MatchingRuleWithReprocessing {
  rule: MatchingRule;
  reprocessing: ReprocessingResult;
}

/**
 * Result of testing a rule against a sample transaction
 */
export interface TestRuleResult {
  matches: boolean;
  result: RuleEvaluationResult;
}

/**
 * Service encapsulating all business logic and data access for matching
 * rules: CRUD, reordering, and testing rules against sample transactions.
 *
 * Every mutating operation (create/update/delete) also reprocesses affected
 * pending transactions so previously-unmatched transactions can pick up the
 * new/changed rule.
 */
export class MatchingRulesService {
  /**
   * List all rules applicable to a bank account (account-specific + global),
   * ordered by priority ascending.
   */
  async listRulesForAccount(accountId: string): Promise<MatchingRule[]> {
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: accountId },
    });

    if (!bankAccount) {
      throw new Error('Bank account not found');
    }

    return prisma.matchingRule.findMany({
      where: {
        OR: [{ bankAccountId: accountId }, { bankAccountId: null }],
      },
      orderBy: { priority: 'asc' },
    });
  }

  /**
   * Create a new rule scoped to a bank account. The new rule is appended
   * after any existing rules for the account (max priority + 1, or 0 if
   * none exist). Reprocesses pending transactions for the account afterward.
   */
  async createRule(
    accountId: string,
    data: CreateMatchingRule
  ): Promise<MatchingRuleWithReprocessing> {
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: accountId },
    });

    if (!bankAccount) {
      throw new Error('Bank account not found');
    }

    // Get max priority for this account
    const maxPriorityRule = await prisma.matchingRule.findFirst({
      where: { bankAccountId: accountId },
      orderBy: { priority: 'desc' },
    });

    const newPriority = maxPriorityRule ? maxPriorityRule.priority + 1 : 0;

    const rule = await prisma.matchingRule.create({
      data: {
        bankAccountId: accountId,
        priority: newPriority,
        ...data,
      },
    });

    const reprocessing = await reprocessPendingTransactions(accountId);

    return { rule, reprocessing };
  }

  /**
   * Fetch a single rule by ID (account-specific or global).
   */
  async getRuleById(id: string): Promise<MatchingRule> {
    const rule = await prisma.matchingRule.findUnique({
      where: { id },
    });

    if (!rule) {
      throw new Error('Matching rule not found');
    }

    return rule;
  }

  /**
   * Update an account-specific rule. Global rules (bankAccountId === null)
   * cannot be modified. Reprocesses pending transactions for the rule's
   * bank account afterward.
   */
  async updateRule(
    id: string,
    data: Omit<UpdateMatchingRule, 'id'>
  ): Promise<MatchingRuleWithReprocessing> {
    const existingRule = await prisma.matchingRule.findUnique({
      where: { id },
    });

    if (!existingRule) {
      throw new Error('Matching rule not found');
    }

    if (existingRule.bankAccountId === null) {
      throw new Error('Cannot modify global rules');
    }

    const rule = await prisma.matchingRule.update({
      where: { id },
      data,
    });

    const reprocessing = await reprocessPendingTransactions(existingRule.bankAccountId);

    return { rule, reprocessing };
  }

  /**
   * Delete an account-specific rule. Global rules cannot be deleted.
   * Reprocesses pending transactions for the rule's bank account afterward.
   */
  async deleteRule(id: string): Promise<{ reprocessing: ReprocessingResult }> {
    const existingRule = await prisma.matchingRule.findUnique({
      where: { id },
    });

    if (!existingRule) {
      throw new Error('Matching rule not found');
    }

    if (existingRule.bankAccountId === null) {
      throw new Error('Cannot delete global rules');
    }

    await prisma.matchingRule.delete({
      where: { id },
    });

    const reprocessing = await reprocessPendingTransactions(existingRule.bankAccountId);

    return { reprocessing };
  }

  /**
   * Reorder a set of rules based on their position in `ruleIds`: the rule
   * at index N is given priority N. All rules must exist and must be
   * account-specific (no global rules) - reordering is atomic.
   */
  async reorderRules(ruleIds: string[]): Promise<void> {
    const rules = await prisma.matchingRule.findMany({
      where: { id: { in: ruleIds } },
    });

    if (rules.length !== ruleIds.length) {
      throw new Error('One or more rules not found');
    }

    const hasGlobalRule = rules.some((rule) => rule.bankAccountId === null);
    if (hasGlobalRule) {
      throw new Error('Cannot reorder global rules');
    }

    await prisma.$transaction(
      ruleIds.map((ruleId, index) =>
        prisma.matchingRule.update({
          where: { id: ruleId },
          data: { priority: index },
        })
      )
    );
  }

  /**
   * Evaluate a rule against a synthetic sample transaction built from the
   * given test data, without touching real transaction data.
   */
  async testRule(id: string, testData: TestRule): Promise<TestRuleResult> {
    const rule = await prisma.matchingRule.findUnique({
      where: { id },
    });

    if (!rule) {
      throw new Error('Matching rule not found');
    }

    // Create a mock bank transaction object
    const mockTransaction: Partial<BankTransaction> = {
      id: 'test',
      bankAccountId: rule.bankAccountId || 'test',
      externalId: 'test',
      description: testData.description,
      amount: testData.amount,
      counterpartyName: testData.counterpartyName || null,
      merchant: testData.merchant || null,
      reference: testData.reference || null,
      currency: 'GBP',
      transactionDate: new Date(),
      settledDate: null,
      importedAt: new Date(),
      category: null,
      transactionId: null,
      pendingTransactionId: null,
    };

    const result = evaluateRules(mockTransaction as BankTransaction, [rule]);
    const matches = result.matchedRules.includes(rule.id);

    return { matches, result };
  }
}

export default new MatchingRulesService();
