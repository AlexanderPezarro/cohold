import { describe, it, expect } from '@jest/globals';
import {
  EventTypeSchema,
  CreateEventSchema,
  UpdateEventSchema,
  EventSchema,
} from '../event.validation';

const propertyId = '123e4567-e89b-12d3-a456-426614174000';
const eventId = '123e4567-e89b-12d3-a456-426614174001';

const validEvent = {
  propertyId,
  eventType: 'Inspection' as const,
  title: 'Annual Property Inspection',
  scheduledDate: new Date('2024-06-01'),
  completed: false,
};

describe('EventTypeSchema', () => {
  it('accepts each valid event type', () => {
    for (const type of [
      'Inspection',
      'Maintenance',
      'Repair',
      'Meeting',
      'Rent Due Date',
      'Lease Renewal',
      'Viewing',
    ]) {
      expect(EventTypeSchema.parse(type)).toBe(type);
    }
  });

  it('rejects an unknown event type', () => {
    expect(() => EventTypeSchema.parse('Party')).toThrow();
  });
});

describe('CreateEventSchema', () => {
  it('accepts a valid event', () => {
    expect(() => CreateEventSchema.parse(validEvent)).not.toThrow();
  });

  it('defaults completed to false when omitted', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit it below
    const { completed, ...withoutCompleted } = validEvent;
    const result = CreateEventSchema.parse(withoutCompleted);
    expect(result.completed).toBe(false);
  });

  it('accepts an optional description', () => {
    expect(() =>
      CreateEventSchema.parse({ ...validEvent, description: 'Routine check' })
    ).not.toThrow();
  });

  it('accepts a null description and completedDate', () => {
    expect(() =>
      CreateEventSchema.parse({ ...validEvent, description: null, completedDate: null })
    ).not.toThrow();
  });

  it('rejects an empty title', () => {
    expect(() => CreateEventSchema.parse({ ...validEvent, title: '' })).toThrow();
  });

  it('rejects an invalid propertyId', () => {
    expect(() => CreateEventSchema.parse({ ...validEvent, propertyId: 'nope' })).toThrow();
  });
});

describe('UpdateEventSchema', () => {
  it('accepts an update with only id', () => {
    expect(() => UpdateEventSchema.parse({ id: eventId })).not.toThrow();
  });

  it('accepts a partial update', () => {
    expect(() => UpdateEventSchema.parse({ id: eventId, completed: true })).not.toThrow();
  });

  it('rejects an invalid id', () => {
    expect(() => UpdateEventSchema.parse({ id: 'nope' })).toThrow();
  });
});

describe('EventSchema', () => {
  it('accepts a valid full event', () => {
    expect(() =>
      EventSchema.parse({
        id: eventId,
        ...validEvent,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).not.toThrow();
  });
});
