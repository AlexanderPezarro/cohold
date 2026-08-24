import { formatCurrency, formatDate } from '../format';

describe('formatCurrency', () => {
  it('formats a positive amount as GBP currency', () => {
    expect(formatCurrency(1234.5)).toBe('£1,234.50');
  });

  it('formats zero as GBP currency', () => {
    expect(formatCurrency(0)).toBe('£0.00');
  });

  it('formats a negative amount as GBP currency', () => {
    expect(formatCurrency(-42.1)).toBe('-£42.10');
  });

  it('returns "N/A" for null', () => {
    expect(formatCurrency(null)).toBe('N/A');
  });

  it('returns "N/A" for undefined', () => {
    expect(formatCurrency(undefined)).toBe('N/A');
  });
});

describe('formatDate', () => {
  it('formats a Date object', () => {
    expect(formatDate(new Date('2024-03-15T00:00:00Z'))).toBe('15 Mar 2024');
  });

  it('formats a date string', () => {
    expect(formatDate('2024-03-15T00:00:00Z')).toBe('15 Mar 2024');
  });

  it('returns "N/A" for null', () => {
    expect(formatDate(null)).toBe('N/A');
  });

  it('returns "N/A" for undefined', () => {
    expect(formatDate(undefined)).toBe('N/A');
  });

  it('returns "N/A" for an empty string', () => {
    expect(formatDate('')).toBe('N/A');
  });

  it('returns "Invalid date" for an unparseable date string', () => {
    expect(formatDate('not-a-real-date')).toBe('Invalid date');
  });
});
