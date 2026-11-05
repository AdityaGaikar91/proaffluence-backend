/**
 * Financial Math & O_Template.xlsx Reverse-Engineered Calculation Engine
 * Implements:
 * 1. Newton-Raphson XIRR with bisection fallback (for periods >= 364 days / ~12 months)
 * 2. Point-to-Point Absolute Return AR_Val (for periods < 364 days)
 * 3. Hybrid 50/50 Asset Allocation Split (or custom scheme-level overrides)
 * 4. Cashflow-Weighted Benchmark Triangulation (Nifty 50 TRI / BSE 500 / Sensex)
 *
 * Absolute-return money math uses decimal.js to avoid IEEE drift on large AUM.
 */
import Decimal from 'decimal.js';

export interface DatedCashflow {
  date: Date;
  amount: number; // Negative for investments/opening, Positive for redemptions/closing
}

function utcCalendarDate(yyyy: number, mm: number, dd: number): Date | null {
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd)) {
    return null;
  }
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (
    dt.getUTCFullYear() !== yyyy ||
    dt.getUTCMonth() !== mm - 1 ||
    dt.getUTCDate() !== dd
  ) {
    return null;
  }
  return dt;
}

/**
 * Parses dd-MM-yyyy or yyyy-MM-dd into a UTC calendar Date.
 * Throws on invalid input — never silently defaults to a hardcoded day.
 */
export function parseDdMmYyyy(dateStr: string): Date {
  const trimmed = (dateStr || '').trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
    const [dd, mm, yyyy] = trimmed.split('-').map(Number);
    const dt = utcCalendarDate(yyyy, mm, dd);
    if (!dt) {
      throw new Error(`Invalid calendar date "${trimmed}" (expected dd-MM-yyyy)`);
    }
    return dt;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const [yyyy, mm, dd] = trimmed.slice(0, 10).split('-').map(Number);
    const dt = utcCalendarDate(yyyy, mm, dd);
    if (!dt) {
      throw new Error(`Invalid calendar date "${trimmed}" (expected yyyy-MM-dd)`);
    }
    return dt;
  }
  throw new Error(
    `Unrecognized date "${trimmed}". Use dd-MM-yyyy or yyyy-MM-dd.`,
  );
}

/** Safe variant for optional parsing — returns null instead of throwing. */
export function tryParseDdMmYyyy(dateStr: string): Date | null {
  try {
    return parseDdMmYyyy(dateStr);
  } catch {
    return null;
  }
}

export function formatDdMmYyyy(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function daysBetween(start: Date, end: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((end.getTime() - start.getTime()) / msPerDay);
}

/**
 * Computes Extended Internal Rate of Return (XIRR) as a percentage (e.g., 16.55 for 16.55%).
 * Cashflow sign convention matching Excel XIRR:
 * - Outflows (Opening Balance + Purchases): negative (-)
 * - Inflows (Redemptions + Closing Balance): positive (+)
 */
export function calculateXirr(
  cashflows: Array<{ date: Date; amount: number }>,
  guess = 0.1,
): number | null {
  const valid = cashflows
    .filter((c) => Number.isFinite(c.amount) && Math.abs(c.amount) > 0.001)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (valid.length < 2) return null;

  const hasPositive = valid.some((c) => c.amount > 0);
  const hasNegative = valid.some((c) => c.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const d0 = valid[0].date.getTime();
  const msPerDay = 1000 * 60 * 60 * 24;

  const npv = (rate: number): number => {
    let sum = 0;
    for (const cf of valid) {
      const years = (cf.date.getTime() - d0) / (msPerDay * 365);
      sum += cf.amount / Math.pow(1 + rate, years);
    }
    return sum;
  };

  const dNpv = (rate: number): number => {
    let sum = 0;
    for (const cf of valid) {
      const years = (cf.date.getTime() - d0) / (msPerDay * 365);
      if (years === 0) continue;
      sum -= (years * cf.amount) / Math.pow(1 + rate, years + 1);
    }
    return sum;
  };

  let rate = guess;
  for (let iter = 0; iter < 100; iter++) {
    if (rate <= -0.9999) rate = -0.9;
    const fVal = npv(rate);
    if (Math.abs(fVal) < 1e-6) {
      return Number((rate * 100).toFixed(2));
    }
    const dfVal = dNpv(rate);
    if (Math.abs(dfVal) < 1e-10) break;
    const nextRate = rate - fVal / dfVal;
    if (Math.abs(nextRate - rate) < 1e-7) {
      return Number((nextRate * 100).toFixed(2));
    }
    rate = Math.max(-0.99, Math.min(10, nextRate));
  }

  // Bisection fallback
  let low = -0.95;
  let high = 5.0;
  let fLow = npv(low);
  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-5) {
      return Number((mid * 100).toFixed(2));
    }
    if (fLow * fMid < 0) {
      high = mid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }

  return Number((rate * 100).toFixed(2));
}

/**
 * Computes Point-to-Point Absolute Return (AR_Val) as a percentage for periods < 12 months.
 * Formula matching O_Template.xlsx DashData (Excel parity):
 * AR_Val = ((Closing + Redemptions - Opening - Purchases) /
 *           (Opening + Purchases - Redemptions)) * 100
 */
export function calculateAbsoluteReturn(params: {
  openingBalance: number;
  purchases: number;
  redemptions: number;
  closingBalance: number;
}): number {
  const opening = new Decimal(params.openingBalance || 0);
  const purchases = new Decimal(params.purchases || 0);
  const redemptions = new Decimal(params.redemptions || 0);
  const closing = new Decimal(params.closingBalance || 0);
  const denominator = opening.plus(purchases).minus(redemptions);
  if (denominator.abs().lte(0.001)) return 0;
  const netGain = closing.plus(redemptions).minus(opening).minus(purchases);
  return Number(netGain.div(denominator).times(100).toFixed(2));
}

/**
 * O_Template.xlsx 12-Month Switch Rule:
 * - Periods >= 364 days (covers non-leap Apr 1 → Mar 31 = 364 days) -> XIRR_Val
 * - Periods < 364 days -> AR_Val (Point-to-Point Absolute Return)
 */
export const TWELVE_MONTH_DAY_THRESHOLD = 364;

export function resolveReturnBy12MonthRule(params: {
  startDate: Date;
  endDate: Date;
  xirrVal: number | null;
  arVal: number | null;
}): { value: number | null; method: 'XIRR' | 'AR' | 'UNAVAILABLE' } {
  const durationDays = daysBetween(params.startDate, params.endDate);
  if (durationDays >= TWELVE_MONTH_DAY_THRESHOLD) {
    if (params.xirrVal === null) {
      return { value: null, method: 'UNAVAILABLE' };
    }
    return { value: params.xirrVal, method: 'XIRR' };
  }
  if (params.arVal === null) {
    return { value: null, method: 'UNAVAILABLE' };
  }
  return { value: params.arVal, method: 'AR' };
}

/** Normalize asset category labels (STOCK → STOCKS). */
export function normalizeAssetCategory(raw: string | undefined | null): string {
  const upper = (raw || '').trim().toUpperCase();
  if (upper === 'STOCK' || upper === 'STOCKS') return 'STOCKS';
  if (upper === 'MF' || upper === 'MUTUAL FUND' || upper === 'MUTUAL_FUND')
    return 'MF';
  if (upper === 'PMS') return 'PMS';
  return upper;
}

export function monthKeyFromDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Last calendar day of a YYYY-MM monthKey as UTC Date. */
export function lastDayOfMonthKey(monthKey: string): Date {
  const [yyyy, mm] = monthKey.split('-').map(Number);
  // Day 0 of next month = last day of this month
  return new Date(Date.UTC(yyyy, mm, 0));
}

/** First day of the Indian FY that contains a YYYY-MM monthKey (01-04 of FY start year). */
export function firstDayOfFyContainingMonthKey(monthKey: string): Date {
  const [yyyy, mm] = monthKey.split('-').map(Number);
  const fyStartYear = mm < 4 ? yyyy - 1 : yyyy;
  return new Date(Date.UTC(fyStartYear, 3, 1));
}

export function resolveRowMonthKey(row: {
  monthKey?: string | null;
  dateOfEntry?: string;
}): string | null {
  if (row.monthKey && /^\d{4}-(0[1-9]|1[0-2])$/.test(row.monthKey.trim())) {
    return row.monthKey.trim();
  }
  if (row.dateOfEntry) {
    return monthKeyFromDate(parseDdMmYyyy(row.dateOfEntry));
  }
  return null;
}

/**
 * Sum closing balances as of a period end using monthKey (system of record).
 * Preference: exact monthKey match → nearest monthKey on/before period end.
 * dateOfEntry is NOT used for FY matching (entry date ≠ valuation month).
 */
export function sumClosingBalancesAtPeriodEnd(params: {
  closingBalances: Array<{
    monthKey?: string | null;
    dateOfEntry?: string;
    closingAmount: number | null | undefined;
    category?: string;
    subCategory?: string;
  }>;
  periodEnd: Date;
  category?: string | null;
}): number | null {
  const { closingBalances, periodEnd, category } = params;
  if (!closingBalances || closingBalances.length === 0) return null;

  const catNorm =
    category && category !== 'All' ? normalizeAssetCategory(category) : null;

  const filtered = closingBalances
    .map((b) => ({
      ...b,
      resolvedKey: resolveRowMonthKey(b),
    }))
    .filter((b) => {
      if (b.closingAmount === null || b.closingAmount === undefined) return false;
      if (!b.resolvedKey) return false;
      if (!catNorm) return true;
      return normalizeAssetCategory(b.category) === catNorm;
    });

  if (filtered.length === 0) return null;

  const targetKey = monthKeyFromDate(periodEnd);

  const exact = filtered.filter((b) => b.resolvedKey === targetKey);
  if (exact.length > 0) {
    return Math.round(
      exact.reduce((acc, b) => acc + Number(b.closingAmount || 0), 0),
    );
  }

  const onOrBefore = filtered.filter(
    (b) => (b.resolvedKey as string) <= targetKey,
  );
  if (onOrBefore.length === 0) return null;

  const latestKey = onOrBefore
    .map((b) => b.resolvedKey as string)
    .sort()
    .at(-1)!;
  const nearest = onOrBefore.filter((b) => b.resolvedKey === latestKey);
  return Math.round(
    nearest.reduce((acc, b) => acc + Number(b.closingAmount || 0), 0),
  );
}

/**
 * Latest closing total with monthKey strictly before `beforeDate` (exclusive).
 * Used as Since-Inception / first-period opening.
 */
export function sumOpeningClosingBeforeDate(params: {
  closingBalances: Array<{
    monthKey?: string | null;
    dateOfEntry?: string;
    closingAmount: number | null | undefined;
    category?: string;
  }>;
  beforeDate: Date;
  category?: string | null;
}): { amount: number; monthKey: string; asOfDate: Date } | null {
  const { closingBalances, beforeDate, category } = params;
  const beforeKey = monthKeyFromDate(beforeDate);
  const catNorm =
    category && category !== 'All' ? normalizeAssetCategory(category) : null;

  const eligible = closingBalances
    .map((b) => ({ ...b, resolvedKey: resolveRowMonthKey(b) }))
    .filter((b) => {
      if (b.closingAmount === null || b.closingAmount === undefined) return false;
      if (!b.resolvedKey) return false;
      if (b.resolvedKey >= beforeKey) return false;
      if (!catNorm) return true;
      return normalizeAssetCategory(b.category) === catNorm;
    });

  if (eligible.length === 0) return null;

  const latestKey = eligible
    .map((b) => b.resolvedKey as string)
    .sort()
    .at(-1)!;
  const amount = Math.round(
    eligible
      .filter((b) => b.resolvedKey === latestKey)
      .reduce((acc, b) => acc + Number(b.closingAmount || 0), 0),
  );
  if (amount <= 0) return null;
  return {
    amount,
    monthKey: latestKey,
    asOfDate: lastDayOfMonthKey(latestKey),
  };
}

export function earliestClosingMonthKey(
  closingBalances: Array<{ monthKey?: string | null; dateOfEntry?: string }>,
): string | null {
  const keys = closingBalances
    .map((b) => resolveRowMonthKey(b))
    .filter((k): k is string => Boolean(k))
    .sort();
  return keys[0] ?? null;
}

export interface FiscalPeriodWindow {
  fyLabel: string; // e.g. "FY 2021-22"
  startDate: Date;
  endDate: Date;
  isPartial: boolean;
}

/**
 * Generates sequential Financial Year periods matching AddtnlInfo!B7:E21 in O_Template.xlsx
 */
export function generateFiscalPeriods(
  fromPeriodStr: string,
  toPeriodStr: string,
): FiscalPeriodWindow[] {
  const fromDate = parseDdMmYyyy(fromPeriodStr);
  const toDate = parseDdMmYyyy(toPeriodStr);

  if (fromDate.getTime() > toDate.getTime()) {
    return [];
  }

  const startYear =
    fromDate.getUTCMonth() + 1 < 4
      ? fromDate.getUTCFullYear() - 1
      : fromDate.getUTCFullYear();
  const endYear =
    toDate.getUTCMonth() + 1 < 4
      ? toDate.getUTCFullYear() - 1
      : toDate.getUTCFullYear();

  const periods: FiscalPeriodWindow[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const fyStart = new Date(Date.UTC(y, 3, 1)); // April 1
    const fyEnd = new Date(Date.UTC(y + 1, 2, 31)); // March 31

    const effectiveStart =
      fromDate.getTime() > fyStart.getTime() ? fromDate : fyStart;
    const effectiveEnd = toDate.getTime() < fyEnd.getTime() ? toDate : fyEnd;

    const fyLabel = `FY ${y}-${String(y + 1).slice(-2)}`;
    const duration = daysBetween(effectiveStart, effectiveEnd);

    periods.push({
      fyLabel,
      startDate: effectiveStart,
      endDate: effectiveEnd,
      isPartial: duration < 364,
    });
  }

  return periods;
}

/**
 * Splits a portfolio valuation or cashflow amount into Equity and Debt
 * according to O_Template.xlsx & Scope Point 5:
 * - EQUITY -> 100% Equity, 0% Debt
 * - DEBT -> 0% Equity, 100% Debt
 * - HYBRID -> 50% Equity, 50% Debt by default, or custom scheme override ratio
 */
export function splitAssetAllocation(params: {
  amount: number;
  subCategory: string;
  schemeName?: string;
  overrides?: Array<{
    schemeName: string;
    equityRatio: number;
    debtRatio: number;
  }>;
}): { equityAmount: number; debtAmount: number } {
  const { amount, subCategory, schemeName, overrides } = params;
  const normSub = (subCategory || '').trim().toUpperCase();

  if (normSub === 'DEBT') {
    return { equityAmount: 0, debtAmount: amount };
  }

  if (normSub === 'HYBRID') {
    let eqRatio = 50;
    if (schemeName && overrides && overrides.length > 0) {
      const matched = overrides.find(
        (o) => o.schemeName.toLowerCase() === schemeName.toLowerCase(),
      );
      if (matched) {
        eqRatio = matched.equityRatio;
      }
    }
    const equityAmount = Number(((amount * eqRatio) / 100).toFixed(2));
    const debtAmount = Number((amount - equityAmount).toFixed(2));
    return { equityAmount, debtAmount };
  }

  // Default EQUITY
  return { equityAmount: amount, debtAmount: 0 };
}

/**
 * Computes Cashflow-Weighted Benchmark Return (Scope Point 6)
 * Aligns actual client purchase/redemption dates to the benchmark index series.
 */
export function calculateCashflowWeightedBenchmarkReturn(params: {
  cashflows: Array<{ date: Date; amount: number }>; // negative for purchase, positive for redemption
  indexQuotes: Array<{ date: Date; closingValue: number }>;
  periodStart: Date;
  periodEnd: Date;
  /** @deprecated Invented fallbacks violate zero-estimation; ignored. Prefer null. */
  fallbackReturn?: number | null;
}): number | null {
  const { cashflows, indexQuotes, periodStart, periodEnd } = params;

  if (!indexQuotes || indexQuotes.length < 2) {
    return null;
  }

  const sortedQuotes = indexQuotes
    .filter((q) => Number.isFinite(q.closingValue) && q.closingValue > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Nearest-PREVIOUS close on/before the target date only.
  // Never forward-fills a future quote into an earlier FY (that invented
  // 0%/garbage Nifty figures when only 2026 quotes existed).
  const findNearestQuote = (target: Date): number | null => {
    let best: number | null = null;
    for (const q of sortedQuotes) {
      if (q.date.getTime() <= target.getTime()) best = q.closingValue;
      else break;
    }
    return best;
  };

  if (sortedQuotes.length < 2) {
    return null;
  }

  const endIndexLevel = findNearestQuote(periodEnd);
  const startIndexLevel = findNearestQuote(periodStart);
  if (endIndexLevel === null || startIndexLevel === null) {
    return null;
  }

  const periodCashflows = cashflows.filter(
    (cf) =>
      cf.date.getTime() >= periodStart.getTime() &&
      cf.date.getTime() <= periodEnd.getTime(),
  );

  if (periodCashflows.length === 0) {
    if (startIndexLevel > 0) {
      return Number(
        (((endIndexLevel - startIndexLevel) / startIndexLevel) * 100).toFixed(
          2,
        ),
      );
    }
    return null;
  }

  let totalUnits = 0;
  const syntheticCashflows: Array<{ date: Date; amount: number }> = [];

  for (const cf of periodCashflows) {
    const level = findNearestQuote(cf.date);
    if (level === null || level <= 0) return null;
    // cf.amount < 0 means purchase into portfolio -> buy benchmark units
    const unitsDelta = -cf.amount / level;
    totalUnits += unitsDelta;
    syntheticCashflows.push({ date: cf.date, amount: cf.amount });
  }

  const terminalBenchmarkValue = Math.max(0, totalUnits * endIndexLevel);
  if (terminalBenchmarkValue <= 0) {
    return null;
  }

  syntheticCashflows.push({ date: periodEnd, amount: terminalBenchmarkValue });

  const durationDays = daysBetween(periodStart, periodEnd);
  if (durationDays >= TWELVE_MONTH_DAY_THRESHOLD) {
    return calculateXirr(syntheticCashflows);
  }

  const purchases = periodCashflows
    .filter((c) => c.amount < 0)
    .reduce((acc, c) => acc + Math.abs(c.amount), 0);
  const redemptions = periodCashflows
    .filter((c) => c.amount > 0)
    .reduce((acc, c) => acc + c.amount, 0);

  return calculateAbsoluteReturn({
    openingBalance: 0,
    purchases,
    redemptions,
    closingBalance: terminalBenchmarkValue,
  });
}
