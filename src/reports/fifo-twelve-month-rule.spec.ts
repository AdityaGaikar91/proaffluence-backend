import Decimal from 'decimal.js';
import { CashflowMathService } from '../cashflows/cashflow-math.service';
import {
  formatDdMmYyyy,
  parseDdMmYyyy,
  TWELVE_MONTH_RULE_MIN_DAYS,
} from './financial-math.util';

/**
 * Per-row FIFO return uses the shared inclusive 365-day rule: holdingDays is
 * daysBetween (exclusive), so 364 days apart = 365 days counting both dates.
 */
describe('FIFO per-row return: shared 365-day inclusive rule', () => {
  const svc = new CashflowMathService();
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
  const purchase = parseDdMmYyyy('01-04-2025');

  const returnFor = (holdingDays: number) => {
    const redemption = addDays(purchase, holdingDays);
    return svc.calculateReturnFromMatchedLots(
      redemption,
      [
        {
          lotId: 'lot-1',
          purchaseDate: formatDdMmYyyy(purchase),
          costBasis: 100000,
          redeemedAmount: 100000,
          holdingDays,
        },
      ],
      new Decimal(110000),
      new Decimal(100000),
    );
  };

  it('uses the shared constant', () => {
    expect(TWELVE_MONTH_RULE_MIN_DAYS).toBe(365);
  });

  it('363 days apart (364 inclusive) → Absolute Return', () => {
    expect(returnFor(363)).toBe(10);
  });

  it('364 days apart (365 inclusive, 01-04-2025 → 31-03-2026) → XIRR', () => {
    const r = returnFor(364);
    expect(r).not.toBe(10);
    expect(r).toBeGreaterThan(10);
    expect(r).toBeLessThan(10.1);
  });
});
