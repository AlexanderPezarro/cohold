import { GraphQLScalarType, Kind } from 'graphql';
import { propertiesResolvers } from './properties.resolver.js';
import { tenantsResolvers } from './tenants.resolver.js';
import { leasesResolvers } from './leases.resolver.js';
import { transactionsResolvers } from './transactions.resolver.js';
import { eventsResolvers } from './events.resolver.js';
import { documentsResolvers } from './documents.resolver.js';
import { bankAccountsResolvers } from './bankAccounts.resolver.js';
import { matchingRulesResolvers } from './matchingRules.resolver.js';
import { settlementsResolvers } from './settlements.resolver.js';
import { syncLogsResolvers } from './syncLogs.resolver.js';
import { auditLogsResolvers } from './auditLogs.resolver.js';
import { usersResolvers } from './users.resolver.js';
import { propertyOwnershipResolvers } from './propertyOwnership.resolver.js';

const dateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  serialize: (value: unknown) => (value instanceof Date ? value.toISOString() : String(value)),
  parseValue: (value: unknown) => (typeof value === 'string' ? new Date(value) : null),
  parseLiteral: (ast) => (ast.kind === Kind.STRING ? new Date(ast.value) : null),
});

export const resolvers = {
  Query: {
    ...propertiesResolvers.Query,
    ...tenantsResolvers.Query,
    ...leasesResolvers.Query,
    ...transactionsResolvers.Query,
    ...eventsResolvers.Query,
    ...documentsResolvers.Query,
    ...bankAccountsResolvers.Query,
    ...matchingRulesResolvers.Query,
    ...settlementsResolvers.Query,
    ...syncLogsResolvers.Query,
    ...auditLogsResolvers.Query,
    ...usersResolvers.Query,
    ...propertyOwnershipResolvers.Query,
  },
  Mutation: {
    ...propertiesResolvers.Mutation,
    ...tenantsResolvers.Mutation,
    ...leasesResolvers.Mutation,
    ...transactionsResolvers.Mutation,
    ...eventsResolvers.Mutation,
    ...settlementsResolvers.Mutation,
    ...matchingRulesResolvers.Mutation,
    ...usersResolvers.Mutation,
    ...propertyOwnershipResolvers.Mutation,
  },
  Property: propertiesResolvers.Property,
  Tenant: tenantsResolvers.Tenant,
  Lease: leasesResolvers.Lease,
  DateTime: dateTimeScalar,
};
