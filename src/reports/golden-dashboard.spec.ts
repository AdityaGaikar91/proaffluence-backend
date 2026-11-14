import { ABC_REFERENCE_DASHBOARD, DUMMY_REFERENCE_DASHBOARD } from './o-template.engine';
import {
  calculateAbsoluteReturn,
  resolveReturnBy12MonthRule,
  TWELVE_MONTH_RULE_MIN_DAYS,
} from './financial-math.util';

/**
 * Golden-file style parity checks against ABC / Dummy reference dashboards
 * (layout regression fixtures used when USE_REFERENCE_DASHBOARD=true).
 */
describe('Golden ABC / Dummy dashboard fixtures', () => {
  it('ABC reference since-inception XIRR and FY 2026-27 row match sample PDF cells', () => {
    expect(ABC_REFERENCE_DASHBOARD.portfolioReturns).toBe(11.74);
    const fy = ABC_REFERENCE_DASHBOARD.summary.find(
      (r) => r.financialYear === 'FY 2026-27',
    );
    expect(fy).toBeDefined();
    expect(fy!.valueAsOn3103).toBe(17345177);
    expect(fy!.newInvestments).toBe(-1327289);
    expect(fy!.xirr).toBe(24.04);
    expect(fy!.nifty50Tri).toBe(14.28);
  });

  it('Dummy reference portfolio and benchmark KPIs match sample PDF cells', () => {
    expect(DUMMY_REFERENCE_DASHBOARD.portfolioReturns).toBe(16.55);
    expect(DUMMY_REFERENCE_DASHBOARD.benchmark).toBe(9.36);
    const fy = DUMMY_REFERENCE_DASHBOARD.summary.find(
      (r) => r.financialYear === 'FY 2026-27',
    );
    expect(fy!.valueAsOn3103).toBe(270954587);
    expect(fy!.xirr).toBe(22.28);
  });

  it('12-month rule: a full FY (365 days inclusive) resolves to XIRR', () => {
    expect(TWELVE_MONTH_RULE_MIN_DAYS).toBe(365);
    const start = new Date(Date.UTC(2025, 3, 1));
    const end = new Date(Date.UTC(2026, 2, 31));
    const resolved = resolveReturnBy12MonthRule({
      startDate: start,
      endDate: end,
      xirrVal: 12.5,
      arVal: 5,
    });
    expect(resolved.method).toBe('XIRR');
    expect(resolved.value).toBe(12.5);
  });

  it('AR denominator uses opening+purchases-redemptions (Net Investment basis)', () => {
    // (160 + 10 - 100 - 50) / (100 + 50 - 10) = 20 / 140 = 14.29
    expect(
      calculateAbsoluteReturn({
        openingBalance: 100,
        purchases: 50,
        redemptions: 10,
        closingBalance: 160,
      }),
    ).toBe(14.29);
  });
});
