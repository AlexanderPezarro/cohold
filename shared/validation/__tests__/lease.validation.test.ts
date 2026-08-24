import { describe, it, expect } from '@jest/globals';
import {
  LeaseStatusSchema,
  CreateLeaseSchema,
  UpdateLeaseSchema,
  LeaseSchema,
} from '../lease.validation';

const propertyId = '123e4567-e89b-12d3-a456-426614174000';
const tenantId = '123e4567-e89b-12d3-a456-426614174001';
const leaseId = '123e4567-e89b-12d3-a456-426614174002';

const validLease = {
  propertyId,
  tenantId,
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-12-31'),
  monthlyRent: 1200,
  securityDepositAmount: 1200,
  status: 'Active' as const,
};

describe('LeaseStatusSchema', () => {
  it('accepts each valid status', () => {
    for (const status of ['Upcoming', 'Active', 'Ended']) {
      expect(LeaseStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects an unknown status', () => {
    expect(() => LeaseStatusSchema.parse('Cancelled')).toThrow();
  });
});

describe('CreateLeaseSchema', () => {
  it('accepts a valid lease with startDate before endDate', () => {
    expect(() => CreateLeaseSchema.parse(validLease)).not.toThrow();
  });

  it('accepts a lease where startDate equals endDate', () => {
    const sameDay = new Date('2024-06-01');
    expect(() =>
      CreateLeaseSchema.parse({ ...validLease, startDate: sameDay, endDate: sameDay })
    ).not.toThrow();
  });

  it('rejects a lease where endDate is before startDate', () => {
    expect(() =>
      CreateLeaseSchema.parse({ ...validLease, endDate: new Date('2023-12-31') })
    ).toThrow();
  });

  it('accepts a lease with no endDate (ongoing)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit it below
    const { endDate, ...withoutEndDate } = validLease;
    expect(() => CreateLeaseSchema.parse(withoutEndDate)).not.toThrow();
  });

  it('accepts a null endDate', () => {
    expect(() => CreateLeaseSchema.parse({ ...validLease, endDate: null })).not.toThrow();
  });

  it('rejects a non-positive monthlyRent', () => {
    expect(() => CreateLeaseSchema.parse({ ...validLease, monthlyRent: 0 })).toThrow();
  });

  it('rejects a non-positive securityDepositAmount', () => {
    expect(() =>
      CreateLeaseSchema.parse({ ...validLease, securityDepositAmount: -1 })
    ).toThrow();
  });

  it('rejects an invalid propertyId', () => {
    expect(() => CreateLeaseSchema.parse({ ...validLease, propertyId: 'nope' })).toThrow();
  });
});

describe('UpdateLeaseSchema', () => {
  it('accepts an update with only id (date refinement skipped)', () => {
    expect(() => UpdateLeaseSchema.parse({ id: leaseId })).not.toThrow();
  });

  it('accepts an update with only startDate (refinement skipped)', () => {
    expect(() =>
      UpdateLeaseSchema.parse({ id: leaseId, startDate: new Date('2024-01-01') })
    ).not.toThrow();
  });

  it('accepts a valid startDate/endDate pair', () => {
    expect(() =>
      UpdateLeaseSchema.parse({
        id: leaseId,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-01'),
      })
    ).not.toThrow();
  });

  it('rejects an endDate before startDate', () => {
    expect(() =>
      UpdateLeaseSchema.parse({
        id: leaseId,
        startDate: new Date('2024-06-01'),
        endDate: new Date('2024-01-01'),
      })
    ).toThrow();
  });

  it('rejects an invalid id', () => {
    expect(() => UpdateLeaseSchema.parse({ id: 'nope' })).toThrow();
  });
});

describe('LeaseSchema', () => {
  it('accepts a valid full lease', () => {
    expect(() =>
      LeaseSchema.parse({
        id: leaseId,
        ...validLease,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).not.toThrow();
  });

  it('rejects a full lease with endDate before startDate', () => {
    expect(() =>
      LeaseSchema.parse({
        id: leaseId,
        ...validLease,
        endDate: new Date('2023-01-01'),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).toThrow();
  });
});
