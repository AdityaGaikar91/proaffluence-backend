import {
  calculateAbsoluteReturn,
  calculateCashflowWeightedBenchmarkReturn,
  daysBetween,
  firstDayOfFyContainingMonthKey,
  formatDdMmYyyy,
  lastDayOfMonthKey,
  monthKeyFromDate,
  parseDdMmYyyy,
  tryParseDdMmYyyy,
  resolveReturnBy12MonthRule,
  sumClosingBalancesAtPeriodEnd,
  sumOpeningClosingBeforeDate,
  TWELVE_MONTH_DAY_THRESHOLD,
} from './financial-math.util';

describe('sumClosingBalancesAtPeriodEnd (monthKey)', () => {
  it('matches by monthKey even when dateOfEntry differs from period end', () => {
    const periodEnd = parseDdMmYyyy('31-03-2021');
    const total = sumClosingBalancesAtPeriodEnd({
      closingBalances: [
        {
          monthKey: '2021-03',
          dateOfEntry: '24-09-2025',
          closingAmount: 1_000_000,
          category: 'MF',
        },
        {
          monthKey: '2021-03',
          dateOfEntry: '24-09-2025',
          closingAmount: 500_000,
          category: 'PMS',
        },
      ],
      periodEnd,
    });
    expect(total).toBe(1_500_000);
  });

  it('does not use a later entry-date cluster when an earlier monthKey matches', () => {
    const periodEnd = parseDdMmYyyy('31-03-2020');
    const total = sumClosingBalancesAtPeriodEnd({
      closingBalances: [
        {
          monthKey: '2020-03',
          dateOfEntry: '15-01-2026',
          closingAmount: 100,
          category: 'MF',
        },
        {
          monthKey: '2025-09',
          dateOfEntry: '30-09-2025',
          closingAmount: 9_999_999,
          category: 'MF',
        },
      ],
      periodEnd,
    });
    expect(total).toBe(100);
  });

  it('falls back to nearest monthKey on or before period end', () => {
    const periodEnd = parseDdMmYyyy('31-03-2022');
    const total = sumClosingBalancesAtPeriodEnd({
      closingBalances: [
        {
          monthKey: '2021-12',
          dateOfEntry: '01-01-2026',
          closingAmount: 42,
        },
      ],
      periodEnd,
    });
    expect(total).toBe(42);
  });
});

describe('resolveReturnBy12MonthRule (>=364)', () => {
  it('uses XIRR for non-leap full Indian FY (364 days)', () => {
    const start = parseDdMmYyyy('01-04-2020');
    const end = parseDdMmYyyy('31-03-2021');
    expect(daysBetween(start, end)).toBe(364);
    expect(TWELVE_MONTH_DAY_THRESHOLD).toBe(364);
    const resolved = resolveReturnBy12MonthRule({
      startDate: start,
      endDate: end,
      xirrVal: 70.66,
      arVal: 46.36,
    });
    expect(resolved.method).toBe('XIRR');
    expect(resolved.value).toBe(70.66);
  });

  it('uses AR for partial HY1 windows under 364 days', () => {
    const start = parseDdMmYyyy('01-04-2026');
    const end = parseDdMmYyyy('30-09-2026');
    expect(daysBetween(start, end)).toBeLessThan(364);
    const resolved = resolveReturnBy12MonthRule({
      startDate: start,
      endDate: end,
      xirrVal: 12.5,
      arVal: 8.1,
    });
    expect(resolved.method).toBe('AR');
    expect(resolved.value).toBe(8.1);
  });
});

describe('calculateAbsoluteReturn (Excel denominator)', () => {
  it('divides gain by opening + purchases - redemptions', () => {
    // netGain = 110 + 20 - 100 - 50 = -20
    // denom  = 100 + 50 - 20 = 130
    // AR     = -20/130 * 100 ≈ -15.38
    const ar = calculateAbsoluteReturn({
      openingBalance: 100,
      purchases: 50,
      redemptions: 20,
      closingBalance: 110,
    });
    expect(ar).toBe(-15.38);
  });

  it('matches FY26-27 style partial window vs opening+purchases-only', () => {
    const opening = 69_288_029;
    const purchases = 1_000_000;
    const redemptions = 5_000_000;
    const closing = 70_000_000;
    const excelStyle = calculateAbsoluteReturn({
      openingBalance: opening,
      purchases,
      redemptions,
      closingBalance: closing,
    });
    const oldDenom = opening + purchases;
    const netGain = closing + redemptions - opening - purchases;
    const oldStyle = Number(((netGain / oldDenom) * 100).toFixed(2));
    expect(excelStyle).not.toBe(oldStyle);
    expect(excelStyle).toBe(
      Number(((netGain / (opening + purchases - redemptions)) * 100).toFixed(2)),
    );
  });
});

describe('calculateCashflowWeightedBenchmarkReturn (no future fill)', () => {
  it('returns null when quotes only exist after the FY window', () => {
    const result = calculateCashflowWeightedBenchmarkReturn({
      cashflows: [],
      indexQuotes: [
        { date: parseDdMmYyyy('30-09-2026'), closingValue: 41250 },
        { date: parseDdMmYyyy('31-10-2026'), closingValue: 41500 },
      ],
      periodStart: parseDdMmYyyy('01-04-2018'),
      periodEnd: parseDdMmYyyy('31-03-2019'),
    });
    expect(result).toBeNull();
  });

  it('computes point-to-point when FY-end quotes exist on/before bounds', () => {
    const result = calculateCashflowWeightedBenchmarkReturn({
      cashflows: [],
      indexQuotes: [
        { date: parseDdMmYyyy('31-03-2018'), closingValue: 100 },
        { date: parseDdMmYyyy('31-03-2019'), closingValue: 120 },
      ],
      periodStart: parseDdMmYyyy('01-04-2018'),
      periodEnd: parseDdMmYyyy('31-03-2019'),
    });
    // nearest on/before 01-04-2018 = 100; on/before 31-03-2019 = 120 → +20%
    expect(result).toBe(20);
  });
});

describe('category mid-FY 12-month rule', () => {
  it('uses AR when first cashflow is ~120 days before FY end', () => {
    const start = parseDdMmYyyy('01-12-2018'); // first STOCK trade
    const end = parseDdMmYyyy('31-03-2019');
    expect(daysBetween(start, end)).toBeLessThan(364);
    const resolved = resolveReturnBy12MonthRule({
      startDate: start,
      endDate: end,
      xirrVal: -12.64,
      arVal: -4.1,
    });
    expect(resolved.method).toBe('AR');
    expect(resolved.value).toBe(-4.1);
  });
});

describe('parseDdMmYyyy (no silent default)', () => {
  it('parses valid dd-MM-yyyy', () => {
    const d = parseDdMmYyyy('30-09-2026');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(8);
    expect(d.getUTCDate()).toBe(30);
  });

  it('rejects invalid calendar day', () => {
    expect(() => parseDdMmYyyy('31-02-2099')).toThrow(/Invalid calendar date/);
  });

  it('rejects garbage', () => {
    expect(() => parseDdMmYyyy('garbage')).toThrow(/Unrecognized date/);
    expect(tryParseDdMmYyyy('garbage')).toBeNull();
  });
});

describe('opening / FY helpers', () => {
  it('sumOpeningClosingBeforeDate returns latest monthKey strictly before first cashflow', () => {
    const opening = sumOpeningClosingBeforeDate({
      closingBalances: [
        { monthKey: '2018-03', closingAmount: 2_500_000, category: 'MF' },
        { monthKey: '2019-03', closingAmount: 3_000_000, category: 'MF' },
      ],
      beforeDate: parseDdMmYyyy('15-04-2018'),
    });
    expect(opening).not.toBeNull();
    expect(opening!.monthKey).toBe('2018-03');
    expect(opening!.amount).toBe(2_500_000);
    expect(formatDdMmYyyy(opening!.asOfDate)).toBe('31-03-2018');
  });

  it('firstDayOfFyContainingMonthKey maps Mar 2018 to 01-04-2017', () => {
    expect(formatDdMmYyyy(firstDayOfFyContainingMonthKey('2018-03'))).toBe(
      '01-04-2017',
    );
  });

  it('lastDayOfMonthKey and monthKeyFromDate round-trip March ends', () => {
    const end = lastDayOfMonthKey('2021-03');
    expect(monthKeyFromDate(end)).toBe('2021-03');
    expect(formatDdMmYyyy(end)).toBe('31-03-2021');
  });
});
