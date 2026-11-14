import { OTemplateEngine } from './o-template.engine';
import {
  calculateXirr,
  filterCashflowsOnOrBefore,
  sumClosingBalancesAtPeriodEnd,
  valuationMonthKeys,
} from './financial-math.util';

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
  fromPeriod?: string;
  toPeriod: string;
}) {
  return new OTemplateEngine().computeMandateDashboard({
    groupHeadId: 'test-head',
    groupHeadName: 'test',
    familyMember: 'All',
    category: 'All',
    inceptionDate: '',
    fromPeriod: params.fromPeriod ?? '',
    toPeriod: params.toPeriod,
    cashflows: params.cashflows,
    closingBalances: params.closingBalances,
    hybridRules: [],
    indexQuotes: [],
  }).dashboard;
}

describe('filterCashflowsOnOrBefore', () => {
  it('keeps rows on or before the report date (inclusive) and drops later ones', () => {
    const rows = [
      cf(1, '30-09-2026', 'Purchase', 1),
      cf(2, '01-10-2026', 'Redemption', 1),
      cf(3, '05-10-2026', 'Redemption', 1),
      cf(4, '01-04-2018', 'Purchase', 1),
    ];
    expect(
      filterCashflowsOnOrBefore(rows, '30-09-2026').map((r) => r.srNo),
    ).toEqual([1, 4]);
  });
});

describe('sumClosingBalancesAtPeriodEnd with valuation snapshots', () => {
  const balances = [
    cb(1, '2022-03', 100, 'MF'),
    cb(2, '2022-03', 50, 'STOCKS'),
    cb(3, '2023-03', 120, 'MF'),
    cb(4, '2024-03', 130, 'MF'),
  ];
  const snapshots = valuationMonthKeys(balances);

  it('reads a category missing from the period-end snapshot as 0 (Excel SUMIFS)', () => {
    expect(
      sumClosingBalancesAtPeriodEnd({
        closingBalances: balances,
        periodEnd: new Date(Date.UTC(2024, 2, 31)),
        category: 'STOCKS',
        snapshotMonthKeys: snapshots,
      }),
    ).toBe(0);
  });

  it('still carries forward without snapshots (legacy behaviour)', () => {
    expect(
      sumClosingBalancesAtPeriodEnd({
        closingBalances: balances,
        periodEnd: new Date(Date.UTC(2024, 2, 31)),
        category: 'STOCKS',
      }),
    ).toBe(50);
  });

  it('uses the latest snapshot on/before the period end when the month itself has none', () => {
    expect(
      sumClosingBalancesAtPeriodEnd({
        closingBalances: balances,
        periodEnd: new Date(Date.UTC(2024, 8, 30)),
        snapshotMonthKeys: snapshots,
      }),
    ).toBe(130);
  });

  it('returns null for a category never valued on/before the snapshot', () => {
    expect(
      sumClosingBalancesAtPeriodEnd({
        closingBalances: balances,
        periodEnd: new Date(Date.UTC(2024, 2, 31)),
        category: 'PMS',
        snapshotMonthKeys: snapshots,
      }),
    ).toBeNull();
  });
});

describe('OTemplateEngine dynamic dashboard', () => {
  const closingBalances = [cb(1, '2018-03', 1000), cb(2, '2019-03', 1700)];
  const inRange = [cf(1, '05-06-2018', 'Purchase', 500)];

  it('ignores cashflows dated after the report date', () => {
    const base = run({
      cashflows: inRange,
      closingBalances,
      toPeriod: '31-03-2019',
    });
    const withLate = run({
      cashflows: [...inRange, cf(2, '05-04-2019', 'Redemption', 300)],
      closingBalances,
      toPeriod: '31-03-2019',
    });
    expect(withLate.portfolioReturns).toBe(base.portfolioReturns);
    expect(withLate.summary).toEqual(base.summary);
    expect(withLate.xirr).toEqual(base.xirr);
  });

  it('prints the opening-only FY as a value line and starts the XIRR/allocation tables after it', () => {
    const dash = run({
      cashflows: inRange,
      closingBalances,
      fromPeriod: '01-04-2016',
      toPeriod: '31-03-2019',
    });
    const fyRows = dash.summary.filter((r) =>
      r.financialYear.startsWith('FY '),
    );
    expect(fyRows.map((r) => r.financialYear)).toEqual([
      'FY 2017-18',
      'FY 2018-19',
    ]);
    expect(fyRows[0]).toMatchObject({
      valueAsOn3103: 1000,
      newInvestments: null,
      xirr: null,
      nifty50Tri: null,
    });
    expect(fyRows[1]).toMatchObject({
      valueAsOn3103: 1700,
      newInvestments: 500,
    });
    expect(
      dash.xirr
        .filter((r) => r.financialYear.startsWith('FY '))
        .map((r) => r.financialYear),
    ).toEqual(['FY 2017-18', 'FY 2018-19']);
    expect(dash.assetAllocation.map((r) => r.financialYear)).toEqual([
      'FY 2017-18',
      'FY 2018-19',
    ]);
    const netInv = dash.summary.find((r) => r.isTotalRow);
    expect(netInv?.newInvestments).toBe(1500);
  });

  it('dates the Since Inception opening on the first day after the opening valuation month', () => {
    const dash = run({
      cashflows: [cf(1, '01-10-2018', 'Purchase', 100)],
      closingBalances: [cb(1, '2018-03', 1000), cb(2, '2019-09', 1300)],
      toPeriod: '30-09-2019',
    });
    const d = (y: number, m: number, day: number) =>
      new Date(Date.UTC(y, m - 1, day));
    const excel = calculateXirr([
      { date: d(2018, 4, 1), amount: -1000 },
      { date: d(2018, 10, 1), amount: -100 },
      { date: d(2019, 9, 30), amount: 1300 },
    ]);
    const monthEnd = calculateXirr([
      { date: d(2018, 3, 31), amount: -1000 },
      { date: d(2018, 10, 1), amount: -100 },
      { date: d(2019, 9, 30), amount: 1300 },
    ]);
    expect(excel).not.toBe(monthEnd);
    expect(dash.portfolioReturns).toBe(excel);
  });

  it('returns no Since Inception XIRR when there is no valuation', () => {
    const dash = run({
      cashflows: [
        cf(1, '05-06-2018', 'Purchase', 500),
        cf(2, '05-06-2019', 'Redemption', 600),
      ],
      closingBalances: [],
      toPeriod: '30-09-2019',
    });
    expect(dash.portfolioReturns).toBeNull();
    expect(dash.summary[0]).toMatchObject({
      financialYear: 'Since Inception',
      xirr: null,
    });
  });

  it('reads a category missing from a later mandate snapshot as 0 in a filtered run', () => {
    const dash = new OTemplateEngine().computeMandateDashboard({
      groupHeadId: 'test-head',
      groupHeadName: 'test',
      familyMember: 'All',
      category: 'STOCKS',
      inceptionDate: '',
      fromPeriod: '',
      toPeriod: '31-03-2024',
      valuationMonthKeys: ['2022-03', '2023-03', '2024-03'],
      cashflows: [cf(1, '05-06-2021', 'Purchase', 100, 'STOCKS')],
      closingBalances: [cb(1, '2022-03', 110, 'STOCKS')],
      hybridRules: [],
      indexQuotes: [],
    }).dashboard;
    const values = dash.summary
      .filter((r) => r.financialYear.startsWith('FY '))
      .map((r) => [r.financialYear, r.valueAsOn3103]);
    expect(values).toEqual([
      ['FY 2021-22', 110],
      ['FY 2022-23', 0],
      ['FY 2023-24', 0],
    ]);
  });

  it('uses absolute return when the first FY starts mid-year with no opening value', () => {
    const dash = run({
      cashflows: [cf(1, '01-12-2021', 'Purchase', 1000)],
      closingBalances: [cb(1, '2022-03', 1100)],
      toPeriod: '31-03-2022',
    });
    const fy = dash.summary.find((r) => r.financialYear === 'FY 2021-22');
    expect(fy?.xirr).toBe(10);
  });
});
