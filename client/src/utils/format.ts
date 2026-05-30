const GBP_FORMAT = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return 'N/A';
  return GBP_FORMAT.format(amount);
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return 'N/A';
  try {
    return DATE_FORMAT.format(typeof date === 'string' ? new Date(date) : date);
  } catch {
    return 'Invalid date';
  }
}
