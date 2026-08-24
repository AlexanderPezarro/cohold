import { describe, it, expect } from '@jest/globals';
import {
  PropertyTypeSchema,
  PropertyStatusSchema,
  CreatePropertySchema,
  UpdatePropertySchema,
  PropertySchema,
} from '../property.validation';

const propertyId = '123e4567-e89b-12d3-a456-426614174000';

const validProperty = {
  name: 'Test Property',
  street: '123 Test Street',
  city: 'London',
  county: 'Greater London',
  postcode: 'SW1A 1AA',
  propertyType: 'Flat' as const,
  status: 'Available' as const,
};

describe('PropertyTypeSchema', () => {
  it('accepts each valid property type', () => {
    for (const type of [
      'House',
      'Flat',
      'Studio',
      'Bungalow',
      'Terraced',
      'Semi-Detached',
      'Detached',
      'Maisonette',
      'Commercial',
    ]) {
      expect(PropertyTypeSchema.parse(type)).toBe(type);
    }
  });

  it('rejects an unknown property type', () => {
    expect(() => PropertyTypeSchema.parse('Castle')).toThrow();
  });
});

describe('PropertyStatusSchema', () => {
  it('accepts each valid status', () => {
    for (const status of ['Available', 'Occupied', 'Under Maintenance', 'For Sale']) {
      expect(PropertyStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects an unknown status', () => {
    expect(() => PropertyStatusSchema.parse('Demolished')).toThrow();
  });
});

describe('CreatePropertySchema', () => {
  it('accepts a valid property', () => {
    expect(() => CreatePropertySchema.parse(validProperty)).not.toThrow();
  });

  it('rejects an invalid UK postcode', () => {
    expect(() =>
      CreatePropertySchema.parse({ ...validProperty, postcode: 'INVALID' })
    ).toThrow();
  });

  it('accepts optional purchaseDate and purchasePrice', () => {
    expect(() =>
      CreatePropertySchema.parse({
        ...validProperty,
        purchaseDate: new Date('2020-01-01'),
        purchasePrice: 250000,
      })
    ).not.toThrow();
  });

  it('accepts a null purchaseDate and purchasePrice', () => {
    expect(() =>
      CreatePropertySchema.parse({ ...validProperty, purchaseDate: null, purchasePrice: null })
    ).not.toThrow();
  });

  it('rejects a non-positive purchase price', () => {
    expect(() =>
      CreatePropertySchema.parse({ ...validProperty, purchasePrice: -100 })
    ).toThrow();
  });

  it('rejects an empty required field', () => {
    expect(() => CreatePropertySchema.parse({ ...validProperty, name: '' })).toThrow();
  });
});

describe('UpdatePropertySchema', () => {
  it('accepts an update with only id', () => {
    expect(() => UpdatePropertySchema.parse({ id: propertyId })).not.toThrow();
  });

  it('accepts a partial update', () => {
    expect(() =>
      UpdatePropertySchema.parse({ id: propertyId, status: 'Occupied' })
    ).not.toThrow();
  });

  it('rejects an invalid id', () => {
    expect(() => UpdatePropertySchema.parse({ id: 'not-a-uuid' })).toThrow();
  });
});

describe('PropertySchema', () => {
  it('accepts a valid full property', () => {
    expect(() =>
      PropertySchema.parse({
        id: propertyId,
        ...validProperty,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).not.toThrow();
  });
});
