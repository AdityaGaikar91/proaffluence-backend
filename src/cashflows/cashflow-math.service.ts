import { Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import {
  calculateXirr,
  daysBetween,
  parseDdMmYyyy,
  TWELVE_MONTH_RULE_MIN_DAYS,
} from '../reports/financial-math.util';

export interface CashflowLot {
  cashflowId: string;
  transactionDate: string; // dd-MM-yyyy
  parsedDate: Date;
  groupHeadId: string;
  familyMemberId?: string | null;
  category: string;
  subCategory: string;
  originalAmount: Decimal;
  remainingAmount: Decimal;
}

export interface FifoMatchedLot {
  lotId: string;
  purchaseDate: string;
  costBasis: number;
  redeemedAmount: number;
  holdingDays: number;
}

export interface CalculationResult {
  newInvestments: number;
  profitLoss: number;
  xirr: number;
  matchedLots: FifoMatchedLot[];
  totalCostBasis: number;
  unmatchedAmount: number;
  isAutoCalculated: boolean;
  notes?: string;
}

export interface CandidateCashflowRow {
  id?: string;
  transactionDate: string;
  transactionType: TransactionType;
  groupHeadId: string;
  familyMemberId?: string | null;
  category: string;
  subCategory: string;
  amounts: number | Decimal;
  newInvestments?: number | null;
  profitLoss?: number | null;
  xirr?: number | null;
}

@Injectable()
export class CashflowMathService {
  /**
   * Generates a composite key for asset grouping.
   * Scoped by: (groupHeadId, familyMemberId, category, subCategory)
   */
  public getAssetKey(
    groupHeadId: string,
    familyMemberId: string | null | undefined,
    category: string,
    subCategory: string,
  ): string {
    const fId = familyMemberId || 'ALL';
    const cat = category.trim().toUpperCase();
    const sub = subCategory.trim().toLowerCase();
    return `${groupHeadId}::${fId}::${cat}::${sub}`;
  }

  /**
   * Computes New_Investments under Investor Cash Flow convention:
   * - Purchase: -Amounts (Cash outflow from investor to acquire asset)
   * - Redemption: +Amounts (Cash inflow returned to investor upon redemption)
   */
  public calculateNewInvestments(
    type: TransactionType,
    amount: number | Decimal,
  ): number {
    const dec = new Decimal(amount);
    if (type === TransactionType.PURCHASE) {
      return dec.negated().toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    }
    return dec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  }

  /**
   * Allocates FIFO lots for a single redemption against available unredeemed purchase lots.
   * Consumes lots chronologically. If unredeemed purchase history is insufficient,
   * treats the remainder as legacy holdings (zero realized gain on unmatched portion).
   */
  public allocateFifoLots(
    redemptionDateStr: string,
    redemptionAmountNum: number | Decimal,
    availableLots: CashflowLot[],
  ): {
    matchedLots: FifoMatchedLot[];
    totalCostBasis: number;
    unmatchedAmount: number;
    realizedProfitLoss: number;
    xirr: number;
  } {
    const redemptionDate = parseDdMmYyyy(redemptionDateStr);
    let remainingToRedeem = new Decimal(redemptionAmountNum);
    const matchedLots: FifoMatchedLot[] = [];
    let matchedCostBasisDec = new Decimal(0);
    let matchedRedemptionDec = new Decimal(0);

    for (const lot of availableLots) {
      if (remainingToRedeem.isZero() || remainingToRedeem.isNegative()) {
        break;
      }
      if (lot.remainingAmount.isZero() || lot.remainingAmount.isNegative()) {
        continue;
      }

      const takeAmount = Decimal.min(lot.remainingAmount, remainingToRedeem);
      lot.remainingAmount = lot.remainingAmount.minus(takeAmount);
      remainingToRedeem = remainingToRedeem.minus(takeAmount);

      const days = Math.max(0, daysBetween(lot.parsedDate, redemptionDate));
      matchedCostBasisDec = matchedCostBasisDec.plus(takeAmount);
      matchedRedemptionDec = matchedRedemptionDec.plus(takeAmount);

      matchedLots.push({
        lotId: lot.cashflowId,
        purchaseDate: lot.transactionDate,
        costBasis: takeAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
        redeemedAmount: takeAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
        holdingDays: days,
      });
    }

    const unmatchedDec = Decimal.max(0, remainingToRedeem);
    const totalRedemptionDec = new Decimal(redemptionAmountNum);

    // If there were matched lots, realized gain is the gain on the matched portion
    // Any unmatched portion assumes cost basis = redemption value (0 gain)
    const realizedGainDec = totalRedemptionDec.minus(matchedCostBasisDec.plus(unmatchedDec));
    const realizedProfitLoss = realizedGainDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    const totalCostBasis = matchedCostBasisDec.plus(unmatchedDec).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

    let computedXirr = 0;
    if (matchedLots.length > 0 && matchedCostBasisDec.gt(0)) {
      computedXirr = this.calculateReturnFromMatchedLots(
        redemptionDate,
        matchedLots,
        matchedRedemptionDec,
        matchedCostBasisDec,
      );
    }

    return {
      matchedLots,
      totalCostBasis,
      unmatchedAmount: unmatchedDec.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      realizedProfitLoss,
      xirr: computedXirr,
    };
  }

  /**
   * Dual-mode return calculation matching O_Template.xlsx:
   * - Holding period < 365 days (purchase and redemption dates inclusive): Point-to-Point Absolute Return AR (%)
   * - Holding period >= 365 days (inclusive; TWELVE_MONTH_RULE_MIN_DAYS): Annualized Newton-Raphson XIRR (%)
   */
  public calculateReturnFromMatchedLots(
    redemptionDate: Date,
    matchedLots: FifoMatchedLot[],
    matchedRedemptionAmount: Decimal,
    matchedCostBasis: Decimal,
  ): number {
    if (matchedCostBasis.isZero() || matchedCostBasis.isNegative()) {
      return 0;
    }

    // Weighted average holding days
    let weightedDaySum = new Decimal(0);
    for (const lot of matchedLots) {
      weightedDaySum = weightedDaySum.plus(
        new Decimal(lot.costBasis).times(lot.holdingDays),
      );
    }
    const avgDays = weightedDaySum.dividedBy(matchedCostBasis).toNumber();

    // Mode 1: Short holding period (< 365 days inclusive) -> Absolute Return %
    // holdingDays is daysBetween (exclusive), so +1 counts both dates (REQUIREMENTS §6.1).
    if (avgDays + 1 < TWELVE_MONTH_RULE_MIN_DAYS) {
      const arPercent = matchedRedemptionAmount
        .minus(matchedCostBasis)
        .dividedBy(matchedCostBasis)
        .times(100);
      return Number(arPercent.toFixed(4));
    }

    // Mode 2: Long holding period (>= 365 days inclusive) -> Newton-Raphson XIRR %
    const cashflows = matchedLots.map((lot) => ({
      date: parseDdMmYyyy(lot.purchaseDate),
      amount: -lot.costBasis,
    }));
    cashflows.push({
      date: redemptionDate,
      amount: matchedRedemptionAmount.toNumber(),
    });

    const xirrVal = calculateXirr(cashflows);
    if (xirrVal !== null && Number.isFinite(xirrVal)) {
      return Number(xirrVal.toFixed(4));
    }

    // Fallback: Annualized CAGR formula if Newton-Raphson fails to converge
    const years = avgDays / 365;
    if (years > 0 && matchedRedemptionAmount.gt(0)) {
      const ratio = matchedRedemptionAmount.dividedBy(matchedCostBasis).toNumber();
      const cagr = (Math.pow(ratio, 1 / years) - 1) * 100;
      if (Number.isFinite(cagr)) {
        return Number(cagr.toFixed(4));
      }
    }

    return 0;
  }

  /**
   * Evaluates a single candidate cashflow row against a running lot pool.
   * If fields are already supplied via manual override, respects user inputs.
   */
  public evaluateRow(
    row: CandidateCashflowRow,
    lotsByKey: Map<string, CashflowLot[]>,
  ): CalculationResult {
    const key = this.getAssetKey(
      row.groupHeadId,
      row.familyMemberId,
      row.category,
      row.subCategory,
    );
    const amountDec = new Decimal(row.amounts);

    // Check if user explicitly gave non-null overrides for all 3 fields
    const hasManualOverride =
      row.newInvestments !== undefined &&
      row.newInvestments !== null &&
      row.profitLoss !== undefined &&
      row.profitLoss !== null &&
      row.xirr !== undefined &&
      row.xirr !== null;

    if (hasManualOverride) {
      // If purchase, still record lot for future redemptions
      if (row.transactionType === TransactionType.PURCHASE) {
        const lots = lotsByKey.get(key) || [];
        lots.push({
          cashflowId: row.id || `temp-${Date.now()}-${Math.random()}`,
          transactionDate: row.transactionDate,
          parsedDate: parseDdMmYyyy(row.transactionDate),
          groupHeadId: row.groupHeadId,
          familyMemberId: row.familyMemberId,
          category: row.category,
          subCategory: row.subCategory,
          originalAmount: amountDec,
          remainingAmount: amountDec,
        });
        lotsByKey.set(key, lots);
      }
      return {
        newInvestments: Number(row.newInvestments),
        profitLoss: Number(row.profitLoss),
        xirr: Number(row.xirr),
        matchedLots: [],
        totalCostBasis: 0,
        unmatchedAmount: 0,
        isAutoCalculated: false,
        notes: 'Manual override provided',
      };
    }

    // Auto-calculate
    const newInvestments = this.calculateNewInvestments(row.transactionType, amountDec);

    if (row.transactionType === TransactionType.PURCHASE) {
      const lots = lotsByKey.get(key) || [];
      lots.push({
        cashflowId: row.id || `lot-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        transactionDate: row.transactionDate,
        parsedDate: parseDdMmYyyy(row.transactionDate),
        groupHeadId: row.groupHeadId,
        familyMemberId: row.familyMemberId,
        category: row.category,
        subCategory: row.subCategory,
        originalAmount: amountDec,
        remainingAmount: amountDec,
      });
      lotsByKey.set(key, lots);

      return {
        newInvestments,
        profitLoss: 0,
        xirr: 0,
        matchedLots: [],
        totalCostBasis: amountDec.toNumber(),
        unmatchedAmount: 0,
        isAutoCalculated: true,
      };
    }

    // Redemption
    const lots = lotsByKey.get(key) || [];
    const allocation = this.allocateFifoLots(row.transactionDate, amountDec, lots);

    return {
      newInvestments,
      profitLoss: allocation.realizedProfitLoss,
      xirr: allocation.xirr,
      matchedLots: allocation.matchedLots,
      totalCostBasis: allocation.totalCostBasis,
      unmatchedAmount: allocation.unmatchedAmount,
      isAutoCalculated: true,
      notes:
        allocation.unmatchedAmount > 0
          ? `Partially unmatched lot (legacy holding ₹${allocation.unmatchedAmount})`
          : undefined,
    };
  }

  /**
   * Sorts candidate rows chronologically by transactionDate and processes them against existing lots.
   */
  public processSequence<T extends CandidateCashflowRow>(
    existingLots: CashflowLot[],
    incomingRows: T[],
  ): Array<Omit<T, 'newInvestments' | 'profitLoss' | 'xirr'> & CalculationResult> {
    const lotsByKey = new Map<string, CashflowLot[]>();

    // Index existing lots
    for (const lot of existingLots) {
      const key = this.getAssetKey(
        lot.groupHeadId,
        lot.familyMemberId,
        lot.category,
        lot.subCategory,
      );
      const list = lotsByKey.get(key) || [];
      list.push({
        ...lot,
        remainingAmount: new Decimal(lot.remainingAmount),
        originalAmount: new Decimal(lot.originalAmount),
      });
      lotsByKey.set(key, list);
    }

    // Sort lots by date ascending
    for (const list of lotsByKey.values()) {
      list.sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());
    }

    // Sort incoming rows chronologically
    const indexed = incomingRows.map((row, idx) => ({
      row,
      originalIdx: idx,
      parsedDate: parseDdMmYyyy(row.transactionDate),
    }));

    indexed.sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());

    const results: Array<
      Omit<T, 'newInvestments' | 'profitLoss' | 'xirr'> & CalculationResult
    > = new Array(incomingRows.length);

    for (const item of indexed) {
      const calc = this.evaluateRow(item.row, lotsByKey);
      results[item.originalIdx] = {
        ...item.row,
        ...calc,
      };
    }

    return results;
  }
}
