import { OTemplateEngine } from './o-template.engine';
import {
  calculateAbsoluteReturn,
  calculateCashflowWeightedBenchmarkReturn,
  calculateXirr,
  generateFiscalPeriods,
  isTwelveMonthPeriod,
  parseDdMmYyyy,
  periodDurationDays,
  formatDdMmYyyy,
  resolveReturnBy12MonthRule,
  sinceInceptionStartDate,
  TWELVE_MONTH_RULE_MIN_DAYS,
  XIRR_DAY_COUNT_BASIS,
} from './financial-math.util';

/**
 * REQUIREMENTS.md §6.1 — 12-Month Rule and Absolute Return formula.
 * XIRR for periods of 12 months or more (>= 365 days, From and To inclusive);
 * Absolute Return = (C + R - O - P) / (O + P) × 100 below that.
 */

const d = parseDdMmYyyy;

const cf = (
  srNo: number,
  transactionDate: string,
  transactionType: 'Purchase' | 'Redemption',
  amounts: number,
  category = 'MF',
) => ({
  srNo,
  dateOfEntry: transactionDate,
  userId: 'ABCDE1234F',
  month: '',
  clientOwner: '',
  groupHeadName: 'test',
  familyMemberName: 'test',
  transactionDate,
  transactionType,
  category,
  subCategory: 'EQUITY',
  amounts,
  newInvestments: 0,
  profitLoss: 0,
  xirr: 0,
});

const cb = (
  srNo: number,
  monthKey: string,
  closingAmount: number,
  category = 'MF',
) => ({
  srNo,
  dateOfEntry: '01-01-2026',
  monthKey,
  userId: 'ABCDE1234F',
  month: monthKey,
  groupHeadName: 'test',
  familyMemberName: 'test',
  category,
  subCategory: 'EQUITY',
  closingAmount,
});

function run(params: {
  cashflows: ReturnType<typeof cf>[];
  closingBalances: ReturnType<typeof cb>[];
  toPeriod: string;
  category?: string;
}) {
  return new OTemplateEngine().computeMandateDashboard({
    groupHeadId: 'rule-test-head',
    groupHeadName: 'test',
    familyMember: 'All',
    category: params.category ?? 'All',
    inceptionDate: '',
    fromPeriod: '',
    toPeriod: params.toPeriod,
    cashflows: params.cashflows,
    closingBalances: params.closingBalances,
    hybridRules: [],
    indexQuotes: [],
  }).dashboard;
}

const summaryRow = (
  dash: ReturnType<typeof run>,
  fy: string,
): ReturnType<typeof run>['summary'][number] | undefined =>
  dash.summary.find((r) => r.financialYear === fy);

describe('12-month rule constants', () => {
  it('uses 365 days and a 365-day XIRR basis', () => {
    expect(TWELVE_MONTH_RULE_MIN_DAYS).toBe(365);
    expect(XIRR_DAY_COUNT_BASIS).toBe(365);
  });
});

describe('periodDurationDays / isTwelveMonthPeriod boundaries', () => {
  it.each([
    // [from, to, inclusive days, XIRR?]
    ['01-04-2026', '30-03-2027', 364, false], // one day short of a full FY
    ['01-04-2026', '31-03-2027', 365, true], // full non-leap FY
    ['01-04-2026', '01-04-2027', 366, true],
    ['01-04-2023', '31-03-2024', 366, true], // full leap FY (29-02-2024)
    ['01-04-2023', '30-03-2024', 365, true], // leap year: 365 days reached a day early
    ['01-04-2023', '29-03-2024', 364, false],
    ['01-03-2024', '27-02-2025', 364, false], // window spanning 29-02-2024
    ['01-03-2024', '28-02-2025', 365, true],
    ['01-04-2026', '30-09-2026', 183, false], // H1 of FY 2026-27
    ['15-06-2026', '15-06-2026', 1, false], // same-day period
  ])('%s → %s is %i days (XIRR=%s)', (from, to, days, xirr) => {
    expect(periodDurationDays(d(from), d(to))).toBe(days);
    expect(isTwelveMonthPeriod(d(from), d(to))).toBe(xirr);
    expect(
      resolveReturnBy12MonthRule({
        startDate: d(from),
        endDate: d(to),
        xirrVal: 11.11,
        arVal: 2.22,
      }).method,
    ).toBe(xirr ? 'XIRR' : 'AR');
  });

  it('returns UNAVAILABLE rather than falling back to the other method', () => {
    expect(
      resolveReturnBy12MonthRule({
        startDate: d('01-04-2020'),
        endDate: d('31-03-2021'),
        xirrVal: null,
        arVal: 5,
      }),
    ).toEqual({ value: null, method: 'UNAVAILABLE' });
    expect(
      resolveReturnBy12MonthRule({
        startDate: d('01-04-2026'),
        endDate: d('30-09-2026'),
        xirrVal: 9,
        arVal: null,
      }),
    ).toEqual({ value: null, method: 'UNAVAILABLE' });
  });

  it('flags FY windows under 12 months as partial', () => {
    const periods = generateFiscalPeriods('01-04-2023', '30-09-2026');
    expect(periods.map((p) => [p.fyLabel, p.isPartial])).toEqual([
      ['FY 2023-24', false],
      ['FY 2024-25', false],
      ['FY 2025-26', false],
      ['FY 2026-27', true],
    ]);
    // Mid-FY start is partial too
    expect(generateFiscalPeriods('15-06-2018', '31-03-2019')[0].isPartial).toBe(
      true,
    );
  });
});

describe('calculateAbsoluteReturn edge cases (denominator = Opening + Purchases)', () => {
  it('zero opening: return on purchases only', () => {
    expect(
      calculateAbsoluteReturn({
        openingBalance: 0,
        purchases: 1_000_000,
        redemptions: 0,
        closingBalance: 1_100_000,
      }),
    ).toBe(10);
  });

  it('redemptions greater than purchases shrink the denominator (Net Investment basis)', () => {
    // gain = 450k + 600k - 1,000k - 100k = -50k ; base = 1,000k + 100k - 600k = 500k -> -50k / 500k * 100 = -10%
    expect(
      calculateAbsoluteReturn({
        openingBalance: 1_000_000,
        purchases: 100_000,
        redemptions: 600_000,
        closingBalance: 450_000,
      }),
    ).toBe(-10);
  });

  it('full exit (closing 0) with redemptions exceeding capital has non-positive denominator → null', () => {
    expect(
      calculateAbsoluteReturn({
        openingBalance: 1_000_000,
        purchases: 0,
        redemptions: 1_200_000,
        closingBalance: 0,
      }),
    ).toBeNull();
  });

  it('zero denominator (no opening, no purchases) is not computable → null', () => {
    expect(
      calculateAbsoluteReturn({
        openingBalance: 0,
        purchases: 0,
        redemptions: 50_000,
        closingBalance: 0,
      }),
    ).toBeNull();
    expect(
      calculateAbsoluteReturn({
        openingBalance: 0,
        purchases: 0,
        redemptions: 0,
        closingBalance: 0,
      }),
    ).toBeNull();
  });

  it('keeps paise precision on large AUM (Output_GL_123 FY 2026-27 basis)', () => {
    expect(
      calculateAbsoluteReturn({
        openingBalance: 69_288_029,
        purchases: 2_918_199.93,
        redemptions: 4_140_000,
        closingBalance: 88_034_048,
      }),
    ).toBe(29.34);
  });
});

describe('calculateXirr guards', () => {
  it('needs both an outflow and an inflow', () => {
    expect(
      calculateXirr([
        { date: d('01-04-2020'), amount: -100 },
        { date: d('31-03-2021'), amount: -50 },
      ]),
    ).toBeNull();
    expect(calculateXirr([{ date: d('01-04-2020'), amount: -100 }])).toBeNull();
  });

  it('a 10% gain over exactly 365 days is 10% XIRR', () => {
    expect(
      calculateXirr([
        { date: d('01-04-2025'), amount: -100 },
        { date: d('01-04-2026'), amount: 110 },
      ]),
    ).toBe(10);
  });
});

describe('benchmark point-to-point uses the same AR denominator', () => {
  it('cashflow-weighted benchmark under 12 months = gain / purchases', () => {
    const result = calculateCashflowWeightedBenchmarkReturn({
      cashflows: [
        { date: d('01-04-2026'), amount: -1000 },
        { date: d('01-07-2026'), amount: 600 },
      ],
      indexQuotes: [
        { date: d('31-03-2026'), closingValue: 100 },
        { date: d('30-06-2026'), closingValue: 100 },
        { date: d('30-09-2026'), closingValue: 120 },
      ],
      periodStart: d('01-04-2026'),
      periodEnd: d('30-09-2026'),
    });
    // units: +10 at 100, -6 at 100 → 4 units × 120 = 480 terminal
    // gain = 480 + 600 - 1000 = 80 ; base = 1000 - 600 = 400 → 20%
    expect(result).toBe(20);
  });
});

describe('engine: 12-month rule & AR denominator on dashboards', () => {
  it('Since Inception younger than 12 months shows AR, not annualised XIRR', () => {
    const dash = run({
      cashflows: [cf(1, '01-01-2026', 'Purchase', 100_000)],
      closingBalances: [cb(1, '2026-03', 105_000), cb(2, '2026-09', 110_000)],
      toPeriod: '30-09-2026',
    });
    expect(summaryRow(dash, 'Since Inception')?.xirr).toBe(10);
    expect(summaryRow(dash, 'FY 2025-26')?.xirr).toBe(5);
    expect(summaryRow(dash, 'FY 2026-27')?.xirr).toBe(4.76);
    expect(dash.header.fromPeriod).toBe('01-01-2026');
  });

  it('Since Inception of exactly 365 days (inclusive) switches to XIRR', () => {
    const dash = run({
      cashflows: [cf(1, '01-10-2025', 'Purchase', 100_000)],
      closingBalances: [cb(1, '2026-03', 104_000), cb(2, '2026-09', 110_000)],
      toPeriod: '30-09-2026',
    });
    // 01-10-2025 → 30-09-2026 = 365 days → XIRR of -100k / +110k over 364 days
    const si = summaryRow(dash, 'Since Inception')?.xirr;
    expect(si).toBe(
      calculateXirr([
        { date: d('01-10-2025'), amount: -100_000 },
        { date: d('30-09-2026'), amount: 110_000 },
      ]),
    );
    expect(si).not.toBe(10);
  });

  it('Since Inception of 364 days (inclusive) stays on AR', () => {
    const dash = run({
      cashflows: [cf(1, '02-10-2025', 'Purchase', 100_000)],
      closingBalances: [cb(1, '2026-03', 104_000), cb(2, '2026-09', 110_000)],
      toPeriod: '30-09-2026',
    });
    expect(summaryRow(dash, 'Since Inception')?.xirr).toBe(10);
  });

  it('partial FY with redemptions > purchases uses Opening + Purchases - Redemptions', () => {
    const dash = run({
      cashflows: [
        cf(1, '15-06-2024', 'Purchase', 1_000_000),
        cf(2, '01-06-2026', 'Redemption', 600_000),
      ],
      closingBalances: [
        cb(1, '2025-03', 950_000),
        cb(2, '2026-03', 1_000_000),
        cb(3, '2026-09', 450_000),
      ],
      toPeriod: '30-09-2026',
    });
    // (450k + 600k - 1,000k - 0) / (1,000k - 600k) = 50k / 400k = 12.50
    expect(summaryRow(dash, 'FY 2026-27')?.xirr).toBe(12.5);
    const xirrRow = dash.xirr.find((r) => r.financialYear === 'FY 2026-27');
    expect(xirrRow?.portfolio).toBe(12.5);
    expect(xirrRow?.mf).toBe(12.5);
  });

  it('a full FY window resolves to XIRR (both non-leap and leap FYs)', () => {
    const dash = run({
      cashflows: [cf(1, '15-06-2022', 'Purchase', 1_000_000)],
      closingBalances: [
        cb(1, '2023-03', 1_050_000),
        cb(2, '2024-03', 1_200_000), // FY 2023-24 is a leap FY
        cb(3, '2025-03', 1_320_000),
      ],
      toPeriod: '31-03-2025',
    });
    const fy2324 = calculateXirr([
      { date: d('01-04-2023'), amount: -1_050_000 },
      { date: d('31-03-2024'), amount: 1_200_000 },
    ]);
    const fy2425 = calculateXirr([
      { date: d('01-04-2024'), amount: -1_200_000 },
      { date: d('31-03-2025'), amount: 1_320_000 },
    ]);
    expect(summaryRow(dash, 'FY 2023-24')?.xirr).toBe(fy2324);
    expect(summaryRow(dash, 'FY 2024-25')?.xirr).toBe(fy2425);
    // First FY starts at the first trade (15-06-2022) → under 12 months → AR 5.00
    expect(summaryRow(dash, 'FY 2022-23')?.xirr).toBe(5);
  });

  it('From Period is the day after the opening valuation month (Excel 01-04-2018 case)', () => {
    const dash = run({
      cashflows: [
        cf(1, '15-06-2018', 'Purchase', 500_000),
        cf(2, '10-10-2018', 'Purchase', 200_000),
      ],
      closingBalances: [
        cb(1, '2018-03', 1_000_000),
        cb(2, '2019-03', 1_800_000),
      ],
      toPeriod: '31-03-2019',
    });
    expect(dash.header.fromPeriod).toBe('01-04-2018');
    // The opening-only FY is still printed as a value line
    const fy1718 = summaryRow(dash, 'FY 2017-18');
    expect(fy1718?.valueAsOn3103).toBe(1_000_000);
    expect(fy1718?.xirr).toBeNull();
  });

  it('cashflows after the report date do not change SI AR or the From Period', () => {
    const base = {
      closingBalances: [cb(1, '2026-03', 105_000), cb(2, '2026-09', 110_000)],
      toPeriod: '30-09-2026',
    };
    const without = run({
      ...base,
      cashflows: [cf(1, '01-01-2026', 'Purchase', 100_000)],
    });
    const withLater = run({
      ...base,
      cashflows: [
        cf(1, '01-01-2026', 'Purchase', 100_000),
        cf(2, '05-10-2026', 'Redemption', 50_000),
      ],
    });
    expect(summaryRow(withLater, 'Since Inception')?.xirr).toBe(
      summaryRow(without, 'Since Inception')?.xirr,
    );
    expect(withLater.header.fromPeriod).toBe(without.header.fromPeriod);
  });

  it('no valuations on/before the report date → SI is blank, not 0', () => {
    const dash = run({
      cashflows: [cf(1, '01-01-2026', 'Purchase', 100_000)],
      closingBalances: [],
      toPeriod: '30-09-2026',
    });
    expect(summaryRow(dash, 'Since Inception')?.xirr).toBeNull();
  });

  it("category SI uses the category's first trade for the 12-month rule", () => {
    const dash = run({
      cashflows: [
        cf(1, '15-06-2018', 'Purchase', 1_000_000, 'MF'),
        cf(2, '01-01-2026', 'Purchase', 200_000, 'PMS'),
      ],
      closingBalances: [
        cb(1, '2019-03', 1_100_000, 'MF'),
        cb(2, '2026-03', 1_500_000, 'MF'),
        cb(3, '2026-03', 210_000, 'PMS'),
        cb(4, '2026-09', 1_600_000, 'MF'),
        cb(5, '2026-09', 230_000, 'PMS'),
      ],
      toPeriod: '30-09-2026',
    });
    const si = dash.xirr.find((r) => r.financialYear === 'Since Inception');
    // PMS: 01-01-2026 → 30-09-2026 (< 12 months) → AR (230k - 200k) / 200k = 15.00
    expect(si?.pms).toBe(15);
    // MF has 8 years of history → XIRR, not AR (60%)
    expect(si?.mf).not.toBe(60);
  });
});

describe('sinceInceptionStartDate (header From Period)', () => {
  const fmt = (dt: Date | null) => (dt ? formatDdMmYyyy(dt) : null);

  it('is the day after the opening valuation month before the first trade', () => {
    expect(
      fmt(
        sinceInceptionStartDate({
          cashflows: [{ transactionDate: '15-06-2018' }],
          closingBalances: [
            { monthKey: '2018-03', closingAmount: 1_000 },
            { monthKey: '2019-03', closingAmount: 2_000 },
          ],
          toPeriod: '30-09-2026',
        }),
      ),
    ).toBe('01-04-2018');
  });

  it('is the first trade date when there is no earlier valuation', () => {
    expect(
      fmt(
        sinceInceptionStartDate({
          cashflows: [
            { transactionDate: '10-12-2018' },
            { transactionDate: '15-04-2021' },
          ],
          closingBalances: [{ monthKey: '2019-03', closingAmount: 2_000 }],
          toPeriod: '30-09-2026',
        }),
      ),
    ).toBe('10-12-2018');
  });

  it('ignores ledger rows after the report date', () => {
    expect(
      fmt(
        sinceInceptionStartDate({
          cashflows: [{ transactionDate: '05-10-2026' }],
          closingBalances: [{ monthKey: '2026-10', closingAmount: 5 }],
          toPeriod: '30-09-2026',
        }),
      ),
    ).toBeNull();
  });

  it('matches the engine header for an unfiltered run', () => {
    const cashflows = [
      cf(1, '15-06-2018', 'Purchase', 500_000),
      cf(2, '10-10-2018', 'Purchase', 200_000, 'PMS'),
    ];
    const closingBalances = [
      cb(1, '2018-03', 1_000_000),
      cb(2, '2019-03', 1_800_000),
    ];
    const dash = run({ cashflows, closingBalances, toPeriod: '31-03-2019' });
    expect(
      fmt(
        sinceInceptionStartDate({
          cashflows,
          closingBalances,
          toPeriod: '31-03-2019',
        }),
      ),
    ).toBe(dash.header.fromPeriod);
  });

  it('mid-FY category entry (< 365 days) selects Absolute Return (e.g. FY 2018-19 STOCK -4.10%)', () => {
    // STOCK cashflows starting 10-12-2018 without prior opening balance
    const stockCfs = [
      cf(1, '10-12-2018', 'Purchase', 8_635_482, 'STOCK'),
      cf(2, '16-01-2019', 'Redemption', 80_000, 'STOCK'),
      cf(3, '28-01-2019', 'Redemption', 59_477.08, 'STOCK'),
      cf(4, '11-03-2019', 'Redemption', 120_000, 'STOCK'),
    ];
    const stockCbs = [
      cb(1, '2019-03', 8_032_689, 'STOCK'),
    ];
    const dash = run({
      cashflows: stockCfs,
      closingBalances: stockCbs,
      inceptionDate: '01-04-2018',
      toPeriod: '31-03-2019',
    });

    const fy1819 = dash.xirr.find((r) => r.financialYear === 'FY 2018-19');
    expect(fy1819).toBeDefined();
    // 120 days holding duration < 365 days -> Absolute Return basis
    expect(fy1819!.stock).toBe(-4.1);
  });
});
