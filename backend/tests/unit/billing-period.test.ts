import { addUtcBillingInterval } from '../../src/modules/subscriptions/billing-period';

describe('UTC billing period arithmetic', () => {
  it('clamps January 31 to the last day of February and preserves the UTC time', () => {
    const start = new Date('2026-01-31T15:04:05.123Z');

    expect(addUtcBillingInterval(start, 'MONTH').toISOString()).toBe('2026-02-28T15:04:05.123Z');
    expect(addUtcBillingInterval(new Date('2024-01-31T15:04:05.123Z'), 'MONTH').toISOString()).toBe(
      '2024-02-29T15:04:05.123Z'
    );
    expect(start.toISOString()).toBe('2026-01-31T15:04:05.123Z');
  });

  it('clamps March 31 to April 30', () => {
    expect(addUtcBillingInterval(new Date('2026-03-31T08:00:00.000Z'), 'MONTH').toISOString()).toBe(
      '2026-04-30T08:00:00.000Z'
    );
  });

  it('clamps February 29 to February 28 in the following non-leap year', () => {
    expect(addUtcBillingInterval(new Date('2024-02-29T12:30:45.500Z'), 'YEAR').toISOString()).toBe(
      '2025-02-28T12:30:45.500Z'
    );
  });

  it('preserves the UTC time of day for a date that exists in the target month', () => {
    expect(addUtcBillingInterval(new Date('2026-05-15T23:59:59.999Z'), 'MONTH').toISOString()).toBe(
      '2026-06-15T23:59:59.999Z'
    );
    expect(addUtcBillingInterval(new Date('2026-05-15T23:59:59.999Z'), 'YEAR').toISOString()).toBe(
      '2027-05-15T23:59:59.999Z'
    );
  });
});
