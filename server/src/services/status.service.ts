import { startOfDay } from 'date-fns';
import type { Prisma } from '@prisma/client';

export type LeaseStatus = 'Upcoming' | 'Active' | 'Ended';
export type TenantStatus = 'Prospective' | 'Active' | 'Former';
export type PropertyStatus = 'Available' | 'Occupied' | 'Under Maintenance' | 'For Sale';

interface LeaseDates {
  startDate: Date;
  endDate: Date | null;
}

// A lease "occupies" a property (and keeps its tenant/property non-idle) for as long as it
// hasn't ended - this covers both 'Upcoming' and 'Active' leases, so callers that only care
// about "is this lease still relevant" don't need to enumerate both.
function isLeaseCurrent(lease: LeaseDates, now: Date): boolean {
  return !lease.endDate || startOfDay(lease.endDate) >= startOfDay(now);
}

export function getLeaseStatus(lease: LeaseDates, now: Date = new Date()): LeaseStatus {
  const today = startOfDay(now);

  if (startOfDay(lease.startDate) > today) {
    return 'Upcoming';
  }

  if (lease.endDate && startOfDay(lease.endDate) < today) {
    return 'Ended';
  }

  return 'Active';
}

export function getTenantStatus(tenant: { leases: LeaseDates[] }, now: Date = new Date()): TenantStatus {
  if (tenant.leases.length === 0) {
    return 'Prospective';
  }

  return tenant.leases.some((lease) => isLeaseCurrent(lease, now)) ? 'Active' : 'Former';
}

export function getPropertyStatus(
  property: { listingState: string | null; leases: LeaseDates[] },
  now: Date = new Date()
): PropertyStatus {
  if (property.listingState === 'UNDER_MAINTENANCE') {
    return 'Under Maintenance';
  }

  if (property.listingState === 'FOR_SALE') {
    return 'For Sale';
  }

  return property.leases.some((lease) => isLeaseCurrent(lease, now)) ? 'Occupied' : 'Available';
}

// Matches isLeaseCurrent's date-only semantics: any lease without a past end date, whether
// it has started yet or not (i.e. 'Upcoming' or 'Active', not 'Ended'). Exported so callers
// like the lease overlap-check (server/src/routes/leases.ts) can reuse the same "current
// lease" definition without duplicating it.
export function buildCurrentLeaseWhere(now: Date = new Date()): Prisma.LeaseWhereInput {
  const today = startOfDay(now);
  return {
    OR: [{ endDate: null }, { endDate: { gte: today } }],
  };
}

export function buildLeaseStatusWhere(status: LeaseStatus, now: Date = new Date()): Prisma.LeaseWhereInput {
  const today = startOfDay(now);

  switch (status) {
    case 'Upcoming':
      return { startDate: { gt: today } };
    case 'Active':
      return {
        startDate: { lte: today },
        ...buildCurrentLeaseWhere(now),
      };
    case 'Ended':
      return { endDate: { lt: today } };
  }
}

export function buildTenantStatusWhere(status: TenantStatus, now: Date = new Date()): Prisma.TenantWhereInput {
  switch (status) {
    case 'Prospective':
      return { leases: { none: {} } };
    case 'Active':
      return { leases: { some: buildCurrentLeaseWhere(now) } };
    case 'Former':
      return {
        AND: [{ leases: { some: {} } }, { NOT: { leases: { some: buildCurrentLeaseWhere(now) } } }],
      };
  }
}

export function buildPropertyStatusWhere(status: PropertyStatus, now: Date = new Date()): Prisma.PropertyWhereInput {
  switch (status) {
    case 'Under Maintenance':
      return { listingState: 'UNDER_MAINTENANCE' };
    case 'For Sale':
      return { listingState: 'FOR_SALE' };
    case 'Occupied':
      return { listingState: null, leases: { some: buildCurrentLeaseWhere(now) } };
    case 'Available':
      return { listingState: null, leases: { none: buildCurrentLeaseWhere(now) } };
  }
}

export function withLeaseStatus<T extends LeaseDates>(lease: T, now: Date = new Date()): T & { status: LeaseStatus } {
  return { ...lease, status: getLeaseStatus(lease, now) };
}

export function withTenantStatus<T extends { leases: LeaseDates[] }>(
  tenant: T,
  now: Date = new Date()
): T & { status: TenantStatus } {
  return { ...tenant, status: getTenantStatus(tenant, now) };
}

export function withPropertyStatus<T extends { listingState: string | null; leases: LeaseDates[] }>(
  property: T,
  now: Date = new Date()
): T & { status: PropertyStatus } {
  return { ...property, status: getPropertyStatus(property, now) };
}
