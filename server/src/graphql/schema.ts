export const typeDefs = `#graphql
  scalar DateTime

  type Property {
    id: ID!
    name: String!
    street: String!
    city: String!
    county: String!
    postcode: String!
    propertyType: String!
    purchaseDate: DateTime
    purchasePrice: Float
    status: String!
    notes: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Tenant {
    id: ID!
    firstName: String!
    lastName: String!
    email: String!
    phone: String!
    emergencyContactName: String
    emergencyContactPhone: String
    status: String!
    notes: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Lease {
    id: ID!
    propertyId: ID!
    tenantId: ID!
    startDate: DateTime!
    endDate: DateTime
    monthlyRent: Float!
    securityDepositAmount: Float!
    securityDepositPaidDate: DateTime
    status: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type TransactionSplit {
    id: ID!
    transactionId: ID!
    userId: ID!
    percentage: Float!
    amount: Float!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Transaction {
    id: ID!
    propertyId: ID!
    leaseId: ID
    type: String!
    category: String!
    amount: Float!
    transactionDate: DateTime!
    description: String!
    paidByUserId: ID
    bankTransactionId: String
    isImported: Boolean!
    importedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    splits: [TransactionSplit!]!
  }

  type Event {
    id: ID!
    propertyId: ID!
    eventType: String!
    title: String!
    description: String
    scheduledDate: DateTime!
    completed: Boolean!
    completedDate: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Document {
    id: ID!
    entityType: String!
    entityId: String!
    fileName: String!
    filePath: String!
    fileType: String!
    fileSize: Int!
    uploadedAt: DateTime!
  }

  type BankAccount {
    id: ID!
    accountId: String!
    accountName: String!
    accountType: String!
    provider: String!
    syncEnabled: Boolean!
    syncFromDate: DateTime!
    lastSyncAt: DateTime
    lastSyncStatus: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type MatchingRule {
    id: ID!
    bankAccountId: ID
    priority: Int!
    enabled: Boolean!
    name: String!
    conditions: String!
    propertyId: ID
    type: String
    category: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Settlement {
    id: ID!
    fromUserId: ID!
    toUserId: ID!
    propertyId: ID!
    amount: Float!
    settlementDate: DateTime!
    notes: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type SyncLog {
    id: ID!
    bankAccountId: ID!
    syncType: String!
    status: String!
    startedAt: DateTime!
    completedAt: DateTime
    transactionsFetched: Int!
    transactionsSkipped: Int!
    transactionsMatched: Int!
    transactionsPending: Int!
    errorMessage: String
    errorDetails: String
    webhookEventId: String
  }

  type TransactionAuditLog {
    id: ID!
    transactionId: String!
    userId: String!
    field: String!
    oldValue: String
    newValue: String
    changedAt: DateTime!
  }

  type User {
    id: ID!
    email: String!
    role: String!
    createdAt: DateTime!
  }

  type PropertyOwnership {
    id: ID!
    userId: ID!
    propertyId: ID!
    ownershipPercentage: Float!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  enum CreatableUserRole {
    LANDLORD
    VIEWER
  }

  input CreateUserInput {
    email: String!
    password: String!
    role: CreatableUserRole
  }

  input CreatePropertyInput {
    name: String!
    street: String!
    city: String!
    county: String!
    postcode: String!
    propertyType: String!
    purchaseDate: DateTime
    purchasePrice: Float
    status: String!
    notes: String
  }

  input UpdatePropertyInput {
    name: String
    street: String
    city: String
    county: String
    postcode: String
    propertyType: String
    purchaseDate: DateTime
    purchasePrice: Float
    status: String
    notes: String
  }

  input CreateTenantInput {
    firstName: String!
    lastName: String!
    email: String!
    phone: String!
    emergencyContactName: String
    emergencyContactPhone: String
    status: String!
    notes: String
  }

  input UpdateTenantInput {
    firstName: String
    lastName: String
    email: String
    phone: String
    emergencyContactName: String
    emergencyContactPhone: String
    status: String
    notes: String
  }

  input CreateLeaseInput {
    propertyId: ID!
    tenantId: ID!
    startDate: DateTime!
    endDate: DateTime
    monthlyRent: Float!
    securityDepositAmount: Float!
    securityDepositPaidDate: DateTime
    status: String!
  }

  input UpdateLeaseInput {
    startDate: DateTime
    endDate: DateTime
    monthlyRent: Float
    securityDepositAmount: Float
    securityDepositPaidDate: DateTime
    status: String
  }

  input CreateTransactionInput {
    propertyId: ID!
    leaseId: ID
    type: String!
    category: String!
    amount: Float!
    transactionDate: DateTime!
    description: String!
    paidByUserId: ID
  }

  input UpdateTransactionInput {
    type: String
    category: String
    amount: Float
    transactionDate: DateTime
    description: String
    paidByUserId: ID
    leaseId: ID
  }

  input CreateEventInput {
    propertyId: ID!
    eventType: String!
    title: String!
    description: String
    scheduledDate: DateTime!
    completed: Boolean
    completedDate: DateTime
  }

  input UpdateEventInput {
    eventType: String
    title: String
    description: String
    scheduledDate: DateTime
    completed: Boolean
    completedDate: DateTime
  }

  input CreateSettlementInput {
    fromUserId: ID!
    toUserId: ID!
    propertyId: ID!
    amount: Float!
    settlementDate: DateTime!
    notes: String
  }

  input UpdateSettlementInput {
    amount: Float
    settlementDate: DateTime
    notes: String
  }

  input CreateMatchingRuleInput {
    bankAccountId: ID
    priority: Int!
    enabled: Boolean
    name: String!
    conditions: String!
    propertyId: ID
    type: String
    category: String
  }

  input UpdateMatchingRuleInput {
    bankAccountId: ID
    priority: Int
    enabled: Boolean
    name: String
    conditions: String
    propertyId: ID
    type: String
    category: String
  }

  type Query {
    properties(status: String, propertyType: String, search: String): [Property!]!
    property(id: ID!): Property

    tenants(status: String, search: String): [Tenant!]!
    tenant(id: ID!): Tenant

    leases(propertyId: ID, tenantId: ID, status: String): [Lease!]!
    lease(id: ID!): Lease

    transactions(propertyId: ID, leaseId: ID, type: String, category: String): [Transaction!]!
    transaction(id: ID!): Transaction

    events(propertyId: ID, eventType: String, completed: Boolean): [Event!]!
    event(id: ID!): Event

    documents(entityType: String, entityId: ID): [Document!]!
    document(id: ID!): Document

    bankAccounts: [BankAccount!]!
    bankAccount(id: ID!): BankAccount

    matchingRules(bankAccountId: ID): [MatchingRule!]!
    matchingRule(id: ID!): MatchingRule

    settlements(propertyId: ID): [Settlement!]!
    settlement(id: ID!): Settlement

    syncLogs(bankAccountId: ID): [SyncLog!]!
    syncLog(id: ID!): SyncLog

    transactionAuditLogs(transactionId: ID): [TransactionAuditLog!]!

    users: [User!]!
    propertyOwners(propertyId: ID!): [PropertyOwnership!]!
  }

  type Mutation {
    createProperty(input: CreatePropertyInput!): Property!
    updateProperty(id: ID!, input: UpdatePropertyInput!): Property
    deleteProperty(id: ID!): Boolean!

    createTenant(input: CreateTenantInput!): Tenant!
    updateTenant(id: ID!, input: UpdateTenantInput!): Tenant
    deleteTenant(id: ID!): Boolean!

    createLease(input: CreateLeaseInput!): Lease!
    updateLease(id: ID!, input: UpdateLeaseInput!): Lease
    deleteLease(id: ID!): Boolean!

    createTransaction(input: CreateTransactionInput!): Transaction!
    updateTransaction(id: ID!, input: UpdateTransactionInput!): Transaction
    deleteTransaction(id: ID!): Boolean!

    createEvent(input: CreateEventInput!): Event!
    updateEvent(id: ID!, input: UpdateEventInput!): Event
    deleteEvent(id: ID!): Boolean!

    createSettlement(input: CreateSettlementInput!): Settlement!
    updateSettlement(id: ID!, input: UpdateSettlementInput!): Settlement
    deleteSettlement(id: ID!): Boolean!

    createMatchingRule(input: CreateMatchingRuleInput!): MatchingRule!
    updateMatchingRule(id: ID!, input: UpdateMatchingRuleInput!): MatchingRule
    deleteMatchingRule(id: ID!): Boolean!

    createUser(input: CreateUserInput!): User!

    addPropertyOwner(propertyId: ID!, userId: ID!, ownershipPercentage: Float!): PropertyOwnership!
    updatePropertyOwnership(propertyId: ID!, userId: ID!, ownershipPercentage: Float!): PropertyOwnership!
    removePropertyOwner(propertyId: ID!, userId: ID!): Boolean!
  }
`;
