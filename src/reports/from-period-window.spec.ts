import { OTemplateEngine } from './o-template.engine';
import { applyFromPeriodWindow } from './financial-math.util';

/**
 * Bug 2(c): a requested From Period later than the data start is respected
 * (opened from the preceding month-end valuation); earlier requests clamp to
 * the data start (Since Inception).
 */

const cf = (
  srNo: number,
  transactionDate: string,
  transactionType: 'Purchase' | 'Redemption',
  amounts: number,
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
  category: 'MF',
  subCategory: 'EQUITY',
  amounts,
  newInvestments: 0,
  profitLoss: 0,
  xirr: 0,
});

const cb = (srNo: number, monthKey: string, closingAmount: number) => ({
  srNo,
  dateOfEntry: '01-01-2026',
  monthKey,
  userId: 'ABCDE1234F',
  month: monthKey,
  groupHeadName: 'test',
  familyMemberName: 'test',
  category: 'MF',
  subCategory: 'EQUITY',
  closingAmount,
});

const TO = '31-03-2026';
const cashflows = [
  cf(1, '15-06-2022', 'Purchase', 100000),
  cf(2, '10-10-2024', 'Purchase', 10000),
];
const closingBalances = [
  cb(1, '2023-03', 110000),
  cb(2, '2024-03', 120000),
  cb(3, '2025-03', 135000),
  cb(4, '2026-03', 150000),
];
const win = (requestedFrom?: string | null) =>
  applyFromPeriodWindow({
    cashflows,
    closingBalances,
    requestedFrom,
    toPeriod: TO,
  });

describe('applyFromPeriodWindow', () => {
  it.each([undefined, null, '', '01-04-2018', '15-06-2022'])(
    'clamps %p (missing or on/before data start) to no window',
    (requested) => {
      const w = win(requested);
      expect(w.windowStart).toBeNull();
      expect(w.cashflows).toHaveLength(2);
      expect(w.closingBalances).toHaveLength(4);
    },
  );

  it('respects a later From Period on a month boundary', () => {
    const w = win('01-04-2024');
    expect(w.windowStart).toBe('01-04-2024');
    expect(w.openingMonthKey).toBe('2024-03');
    expect(w.cashflows.map((c) => c.srNo)).toEqual([2]);
    expect(w.closingBalances.map((b) => b.monthKey)).toEqual([
      '2024-03',
      '2025-03',
      '2026-03',
    ]);
  });

  it('snaps a mid-month From Period back to the day after the prior valuation', () => {
    const w = win('15-05-2024');
    expect(w.windowStart).toBe('01-04-2024');
    expect(w.openingMonthKey).toBe('2024-03');
  });

  it('throws when the From Period is after the To Period', () => {
    expect(() => win('01-04-2026')).toThrow(/after To Period/);
  });

  it('throws when no valuation exists before the From Period', () => {
    expect(() => win('01-08-2022')).toThrow(/no month-end closing valuation/);
  });
});

describe('engine with a From Period window', () => {
  const run = (requestedFrom: string) => {
    const w = win(requestedFrom);
    return new OTemplateEngine().computeMandateDashboard({
      groupHeadId: 'window-test-head',
      groupHeadName: 'test',
      familyMember: 'All',
      category: 'All',
      inceptionDate: '',
      fromPeriod: w.windowStart ?? '',
      toPeriod: TO,
      cashflows: w.cashflows,
      closingBalances: w.closingBalances,
      hybridRules: [],
      indexQuotes: [],
      windowFromPeriod: w.windowStart ?? undefined,
    }).dashboard;
  };

  it('uses the window start as From Period and the opening valuation as seed', () => {
    const dash = run('01-04-2024');
    expect(dash.header.fromPeriod).toBe('01-04-2024');
    const fy = dash.summary.filter((r) => !r.isTotalRow);
    // Nothing from before the window leaks into the FY rows.
    expect(fy.some((r) => r.financialYear.includes('2022'))).toBe(false);
    const fy2425 = fy.find((r) => r.financialYear.includes('2024-25'));
    expect(fy2425?.returnMethod).toBe('XIRR');
    expect(fy2425?.newInvestments).toBe(10000);
    // FY 2024-25: opening 120000, +10000 on 10-10-2024, close 135000.
    expect(fy2425?.valueAsOn3103).toBe(135000);
    expect(fy2425?.xirr).toBeGreaterThan(3);
    expect(fy2425?.xirr).toBeLessThan(5);
  });

  it('every computed summary row carries the engine method', () => {
    const dash = run('01-04-2024');
    const withReturn = dash.summary.filter(
      (r) => !r.isTotalRow && r.xirr !== null,
    );
    expect(withReturn.length).toBeGreaterThan(0);
    for (const r of withReturn) {
      expect(['XIRR', 'AR']).toContain(r.returnMethod);
    }
  });
});
