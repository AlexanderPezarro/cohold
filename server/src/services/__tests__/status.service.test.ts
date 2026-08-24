import { describe, it, expect } from '@jest/globals';
import { startOfDay } from 'date-fns';
import {
  getLeaseStatus,
  getTenantStatus,
  getPropertyStatus,
  buildLeaseStatusWhere,
  buildTenantStatusWhere,
  buildPropertyStatusWhere,
} from '../status.service.js';

// Fixed reference point so date-boundary assertions never depend on wall-clock time.
const NOW = new Date('2026-06-15T12:00:00.000Z');

function daysFromNow(days: number): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  return d;
}

describe('status.service', () => {
  describe('getLeaseStatus', () => {
    it('is Upcoming when the start date is in the future', () => {
      const status = getLeaseStatus({ startDate: daysFromNow(1), endDate: null }, NOW);
      expect(status).toBe('Upcoming');
    });

    it('is Active when it starts today', () => {
      const status = getLeaseStatus({ startDate: daysFromNow(0), endDate: null }, NOW);
      expect(status).toBe('Active');
    });

    it('is Active when it ends today', () => {
      const status = getLeaseStatus({ startDate: daysFromNow(-30), endDate: daysFromNow(0) }, NOW);
      expect(status).toBe('Active');
    });

    it('is Active with no end date (ongoing)', () => {
      const status = getLeaseStatus({ startDate: daysFromNow(-30), endDate: null }, NOW);
      expect(status).toBe('Active');
    });

    it('is Active when today falls within the date range', () => {
      const status = getLeaseStatus({ startDate: daysFromNow(-10), endDate: daysFromNow(10) }, NOW);
      expect(status).toBe('Active');
    });

    it('is Ended when the end date is in the past', () => {
      const status = getLeaseStatus({ startDate: daysFromNow(-60), endDate: daysFromNow(-1) }, NOW);
      expect(status).toBe('Ended');
    });
  });

  describe('getTenantStatus', () => {
    it('is Prospective with no leases at all', () => {
      expect(getTenantStatus({ leases: [] }, NOW)).toBe('Prospective');
    });

    it('is Active with only an ongoing lease', () => {
      const status = getTenantStatus(
        { leases: [{ startDate: daysFromNow(-10), endDate: null }] },
        NOW
      );
      expect(status).toBe('Active');
    });

    it('is Active with only an upcoming lease', () => {
      const status = getTenantStatus(
        { leases: [{ startDate: daysFromNow(5), endDate: daysFromNow(370) }] },
        NOW
      );
      expect(status).toBe('Active');
    });

    it('is Former when every lease has ended', () => {
      const status = getTenantStatus(
        {
          leases: [
            { startDate: daysFromNow(-100), endDate: daysFromNow(-50) },
            { startDate: daysFromNow(-30), endDate: daysFromNow(-1) },
          ],
        },
        NOW
      );
      expect(status).toBe('Former');
    });

    it('is Active when at least one lease among several is current', () => {
      const status = getTenantStatus(
        {
          leases: [
            { startDate: daysFromNow(-100), endDate: daysFromNow(-50) },
            { startDate: daysFromNow(-10), endDate: null },
          ],
        },
        NOW
      );
      expect(status).toBe('Active');
    });
  });

  describe('getPropertyStatus', () => {
    it('is Available with no leases and no listing state', () => {
      const status = getPropertyStatus({ listingState: null, leases: [] }, NOW);
      expect(status).toBe('Available');
    });

    it('is Occupied when it has an active lease', () => {
      const status = getPropertyStatus(
        { listingState: null, leases: [{ startDate: daysFromNow(-10), endDate: null }] },
        NOW
      );
      expect(status).toBe('Occupied');
    });

    it('is Occupied when it only has an upcoming lease', () => {
      const status = getPropertyStatus(
        { listingState: null, leases: [{ startDate: daysFromNow(5), endDate: daysFromNow(200) }] },
        NOW
      );
      expect(status).toBe('Occupied');
    });

    it('is Available when its only lease has ended', () => {
      const status = getPropertyStatus(
        { listingState: null, leases: [{ startDate: daysFromNow(-100), endDate: daysFromNow(-1) }] },
        NOW
      );
      expect(status).toBe('Available');
    });

    it('is Under Maintenance when listingState overrides, even with an active lease', () => {
      const status = getPropertyStatus(
        {
          listingState: 'UNDER_MAINTENANCE',
          leases: [{ startDate: daysFromNow(-10), endDate: null }],
        },
        NOW
      );
      expect(status).toBe('Under Maintenance');
    });

    it('is For Sale when listingState overrides an otherwise-available property', () => {
      const status = getPropertyStatus({ listingState: 'FOR_SALE', leases: [] }, NOW);
      expect(status).toBe('For Sale');
    });
  });

  describe('buildLeaseStatusWhere', () => {
    it.each([['Upcoming'], ['Active'], ['Ended']] as const)(
      'returns a where clause for %s',
      (status) => {
        const where = buildLeaseStatusWhere(status, NOW);
        expect(where).toBeTruthy();
        expect(typeof where).toBe('object');
      }
    );
  });

  describe('buildTenantStatusWhere', () => {
    it('Prospective filters to tenants with no leases', () => {
      const where = buildTenantStatusWhere('Prospective', NOW);
      expect(where).toEqual({ leases: { none: {} } });
    });

    it('Active filters to tenants with a current lease', () => {
      const where = buildTenantStatusWhere('Active', NOW);
      expect(where).toEqual({
        leases: { some: { OR: [{ endDate: null }, { endDate: { gte: startOfDay(NOW) } }] } },
      });
    });

    it('Former filters to tenants with leases but none current', () => {
      const where = buildTenantStatusWhere('Former', NOW);
      expect(where).toEqual({
        AND: [
          { leases: { some: {} } },
          { NOT: { leases: { some: { OR: [{ endDate: null }, { endDate: { gte: startOfDay(NOW) } }] } } } },
        ],
      });
    });
  });

  describe('buildPropertyStatusWhere', () => {
    it('Under Maintenance filters on listingState', () => {
      const where = buildPropertyStatusWhere('Under Maintenance', NOW);
      expect(where).toEqual({ listingState: 'UNDER_MAINTENANCE' });
    });

    it('For Sale filters on listingState', () => {
      const where = buildPropertyStatusWhere('For Sale', NOW);
      expect(where).toEqual({ listingState: 'FOR_SALE' });
    });

    it('Occupied filters to unlisted properties with a current lease', () => {
      const where = buildPropertyStatusWhere('Occupied', NOW);
      expect(where).toEqual({
        listingState: null,
        leases: { some: { OR: [{ endDate: null }, { endDate: { gte: startOfDay(NOW) } }] } },
      });
    });

    it('Available filters to unlisted properties with no current lease', () => {
      const where = buildPropertyStatusWhere('Available', NOW);
      expect(where).toEqual({
        listingState: null,
        leases: { none: { OR: [{ endDate: null }, { endDate: { gte: startOfDay(NOW) } }] } },
      });
    });
  });
});
