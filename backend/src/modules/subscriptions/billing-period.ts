export type UtcBillingInterval = 'MONTH' | 'YEAR';

// Clamp to the last UTC day of the target month. setUTCMonth would roll January 31 into March.
export function addUtcBillingInterval(start: Date, interval: UtcBillingInterval): Date {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  const addedMonths = interval === 'YEAR' ? 12 : 1;
  const targetMonthIndex = month + addedMonths;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      clampedDay,
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds()
    )
  );
}
