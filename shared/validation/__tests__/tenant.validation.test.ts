import { describe, it, expect } from '@jest/globals';
import {
  TenantStatusSchema,
  CreateTenantSchema,
  UpdateTenantSchema,
  TenantSchema,
} from '../tenant.validation';

const tenantId = '123e4567-e89b-12d3-a456-426614174000';

const validTenant = {
  firstName: 'John',
  lastName: 'Doe',
  email: 'john.doe@example.com',
  phone: '07123456789',
  status: 'Active' as const,
};

describe('TenantStatusSchema', () => {
  it('accepts each valid status', () => {
    for (const status of ['Prospective', 'Active', 'Former']) {
      expect(TenantStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects an unknown status', () => {
    expect(() => TenantStatusSchema.parse('Banned')).toThrow();
  });
});

describe('CreateTenantSchema', () => {
  it('accepts a valid tenant', () => {
    expect(() => CreateTenantSchema.parse(validTenant)).not.toThrow();
  });

  it('rejects an invalid email', () => {
    expect(() => CreateTenantSchema.parse({ ...validTenant, email: 'not-an-email' })).toThrow();
  });

  it('rejects an invalid UK phone number', () => {
    expect(() => CreateTenantSchema.parse({ ...validTenant, phone: '123' })).toThrow();
  });

  it('accepts an optional emergency contact', () => {
    expect(() =>
      CreateTenantSchema.parse({
        ...validTenant,
        emergencyContactName: 'Jane Doe',
        emergencyContactPhone: '07123456789',
      })
    ).not.toThrow();
  });

  it('accepts null emergency contact fields', () => {
    expect(() =>
      CreateTenantSchema.parse({
        ...validTenant,
        emergencyContactName: null,
        emergencyContactPhone: null,
      })
    ).not.toThrow();
  });

  it('rejects an empty first name', () => {
    expect(() => CreateTenantSchema.parse({ ...validTenant, firstName: '' })).toThrow();
  });
});

describe('UpdateTenantSchema', () => {
  it('accepts an update with only id', () => {
    expect(() => UpdateTenantSchema.parse({ id: tenantId })).not.toThrow();
  });

  it('accepts a partial update', () => {
    expect(() => UpdateTenantSchema.parse({ id: tenantId, status: 'Former' })).not.toThrow();
  });

  it('rejects an invalid id', () => {
    expect(() => UpdateTenantSchema.parse({ id: 'nope' })).toThrow();
  });
});

describe('TenantSchema', () => {
  it('accepts a valid full tenant', () => {
    expect(() =>
      TenantSchema.parse({
        id: tenantId,
        ...validTenant,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).not.toThrow();
  });
});
