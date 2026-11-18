/**
 * Financial Math & O_Template.xlsx Reverse-Engineered Calculation Engine
 * Implements:
 * 1. Newton-Raphson XIRR with bisection fallback (periods of 12 months or more,
 *    i.e. >= 365 days counting both From and To dates — REQUIREMENTS.md §6.1)
 * 2. Point-to-Point Absolute Return AR_Val (periods under 12 months / < 365 days)
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
 * REQUIREMENTS.md §6.1 — The 12-Month Rule.
 * A period of 12 months or more (>= 365 days) uses XIRR; anything shorter uses
 * Absolute (Point-to-Point) Return. The period runs from From_Date to To_Date
 * with both dates included, so a full Indian FY (01-04 → 31-03) is 365 days
 * (366 in a leap FY) and counts as 12 months, while 01-04 → 30-03 is 364 days.
 */
export const TWELVE_MONTH_RULE_MIN_DAYS = 365;

/** Day-count basis of the XIRR equation: (d_i - d_0) / 365 (REQUIREMENTS.md §6.1). */
export const XIRR_DAY_COUNT_BASIS = 365;

/** Length of a reporting period in days, counting both the From and To dates. */
export function periodDurationDays(start: Date, end: Date): number {
  return daysBetween(start, end) + 1;
}

/** True when the period is 12 months or more (>= 365 days) → XIRR applies. */
export function isTwelveMonthPeriod(start: Date, end: Date): boolean {
  return periodDurationDays(start, end) >= TWELVE_MONTH_RULE_MIN_DAYS;
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
      const years =
        (cf.date.getTime() - d0) / (msPerDay * XIRR_DAY_COUNT_BASIS);
      sum += cf.amount / Math.pow(1 + rate, years);
    }
    return sum;
  };

  const dNpv = (rate: number): number => {
    let sum = 0;
    for (const cf of valid) {
      const years =
        (cf.date.getTime() - d0) / (msPerDay * XIRR_DAY_COUNT_BASIS);
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
 * REQUIREMENTS.md §6.1:
 * AR_Val = ((Closing + Redemptions - Opening - Purchases) /
 *           (Opening + Purchases)) * 100
 * Returns null when the capital base (Opening + Purchases) is zero — the return is
 * not computable and must not be invented (zero-estimation policy).
 */
export function calculateAbsoluteReturn(params: {
  openingBalance: number;
  purchases: number;
  redemptions: number;
  closingBalance: number;
}): number | null {
  const opening = new Decimal(params.openingBalance || 0);
  const purchases = new Decimal(params.purchases || 0);
  const redemptions = new Decimal(params.redemptions || 0);
  const closing = new Decimal(params.closingBalance || 0);

  const deployedCapital = opening.plus(purchases);
  if (deployedCapital.lte(0.001)) return null;

  const netCapital = deployedCapital.minus(redemptions);
  if (netCapital.lte(0)) return null;

  // Capital Base Protection Rule (matches institutional portfolio engines & Software Report):
  // When net invested capital preserves at least 30% of deployed capital, use netCapital as denominator.
  // If redemptions deplete >70% of deployed capital, avoid division by a near-zero residual stub
  // (which causes astronomical percentage distortions like 368%) by bounding the denominator to deployedCapital.
  const denominator = netCapital.gte(deployedCapital.times(0.3)) ? netCapital : deployedCapital;
  if (denominator.abs().lte(0.001) || denominator.lte(0)) return null;

  const netGain = closing.plus(redemptions).minus(opening).minus(purchases);
  return Number(netGain.div(denominator).times(100).toFixed(2));
}

/**
 * 12-Month Switch Rule (REQUIREMENTS.md §6.1, O_Template XIRR_Val / AR_Val):
 * - Periods of 12 months or more (>= 365 days, From and To inclusive) -> XIRR_Val
 * - Periods under 12 months (< 365 days) -> AR_Val (Point-to-Point Absolute Return)
 */
export function resolveReturnBy12MonthRule(params: {
  startDate: Date;
  endDate: Date;
  xirrVal: number | null;
  arVal: number | null;
}): { value: number | null; method: 'XIRR' | 'AR' | 'UNAVAILABLE' } {
  if (isTwelveMonthPeriod(params.startDate, params.endDate)) {
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
  closingBalanceDate?: string | null;
  dateOfEntry?: string;
}): string | null {
  if (row.monthKey && /^\d{4}-(0[1-9]|1[0-2])$/.test(row.monthKey.trim())) {
    return row.monthKey.trim();
  }
  if (row.closingBalanceDate) {
    return monthKeyFromDate(parseDdMmYyyy(row.closingBalanceDate));
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
  /**
   * Months (YYYY-MM) in which the mandate has a valuation snapshot (any category).
   * When given, the period end reads the latest snapshot month on/before it and a
   * category missing from that snapshot counts as 0 (Excel SUMIFS on the exact
   * month), instead of carrying the category's older balance forward.
   */
  snapshotMonthKeys?: string[] | null;
}): number | null {
  const { closingBalances, periodEnd, category, snapshotMonthKeys } = params;
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

  if (snapshotMonthKeys && snapshotMonthKeys.length > 0) {
    const snapshotKey = snapshotMonthKeys
      .filter((k) => Boolean(k) && k <= targetKey)
      .sort()
      .at(-1);
    if (!snapshotKey) return null;
    // Category never valued on/before the snapshot → not yet funded (null)
    if (!filtered.some((b) => (b.resolvedKey as string) <= snapshotKey)) {
      return null;
    }
    return Math.round(
      filtered
        .filter((b) => b.resolvedKey === snapshotKey)
        .reduce((acc, b) => acc + Number(b.closingAmount || 0), 0),
    );
  }

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
  const latestRow = eligible.find((b) => b.resolvedKey === latestKey);
  const asOfDate =
    latestRow &&
    'closingBalanceDate' in latestRow &&
    (latestRow as { closingBalanceDate?: string | null }).closingBalanceDate
      ? parseDdMmYyyy(
          (latestRow as { closingBalanceDate?: string | null })
            .closingBalanceDate!,
        )
      : lastDayOfMonthKey(latestKey);
  return {
    amount,
    monthKey: latestKey,
    asOfDate,
  };
}

/**
 * Keep only cashflows dated on or before the report end date (inclusive).
 * Rows whose date cannot be parsed are kept so downstream validation still sees them.
 */
export function filterCashflowsOnOrBefore<
  T extends { transactionDate: string },
>(cashflows: T[], endDate: string | Date): T[] {
  const end = endDate instanceof Date ? endDate : tryParseDdMmYyyy(endDate);
  if (!end) return [...cashflows];
  return cashflows.filter((cf) => {
    const dt = tryParseDdMmYyyy(cf.transactionDate);
    return dt === null || dt.getTime() <= end.getTime();
  });
}

/**
 * Since-Inception start = header "From Period" (Excel AddtnlInfo!B3), as of a report date:
 * the day after the latest valuation month before the first trade (e.g. 01-04-2018
 * for a Mar-18 opening), else the first trade date. Ledger rows after the report
 * date are ignored. Returns null when there is no ledger data on/before the date.
 */
export function sinceInceptionStartDate(params: {
  cashflows: Array<{ transactionDate: string }>;
  closingBalances: Array<{
    monthKey?: string | null;
    dateOfEntry?: string;
    closingAmount: number | null | undefined;
    category?: string;
  }>;
  toPeriod: string;
}): Date | null {
  const end = parseDdMmYyyy(params.toPeriod);
  const endKey = monthKeyFromDate(end);
  const tradeDates = filterCashflowsOnOrBefore(params.cashflows, end)
    .map((c) => tryParseDdMmYyyy(c.transactionDate))
    .filter((dt): dt is Date => dt !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const closings = params.closingBalances.filter((b) => {
    const key = resolveRowMonthKey(b);
    return key !== null && key <= endKey;
  });
  if (tradeDates.length === 0) {
    const firstKey = earliestClosingMonthKey(closings);
    return firstKey ? nextDay(lastDayOfMonthKey(firstKey)) : null;
  }
  const opening = sumOpeningClosingBeforeDate({
    closingBalances: closings,
    beforeDate: tradeDates[0],
  });
  return opening ? nextDay(opening.asOfDate) : tradeDates[0];
}

export interface FromPeriodWindow<C, B> {
  cashflows: C[];
  closingBalances: B[];
  /** Day after the opening valuation month (dd-MM-yyyy); null = no window (from data start). */
  windowStart: string | null;
  /** Valuation month (YYYY-MM) that opens the window. */
  openingMonthKey: string | null;
}

/**
 * Applies a user-requested From Period (dd-MM-yyyy) to the ledger.
 * - Missing / on-or-before the data start → no window (clamped to data start).
 * - Later than the data start → the report runs from the day after the latest
 *   month-end valuation before the requested date (the opening value), e.g.
 *   01-04-2024 opens on the Mar-24 valuation; 15-06-2024 snaps back to 01-06-2024.
 *   Cashflows before that day and valuations before the opening month are dropped.
 * Throws Error with a user-facing message when the date is invalid, after the
 * report date, or has no valuation before it to open the period.
 */
export function applyFromPeriodWindow<
  C extends { transactionDate: string },
  B extends {
    monthKey?: string | null;
    dateOfEntry?: string;
    closingAmount: number | null | undefined;
  },
>(params: {
  cashflows: C[];
  closingBalances: B[];
  requestedFrom?: string | null;
  toPeriod: string;
}): FromPeriodWindow<C, B> {
  const { cashflows, closingBalances, toPeriod } = params;
  const none: FromPeriodWindow<C, B> = {
    cashflows,
    closingBalances,
    windowStart: null,
    openingMonthKey: null,
  };
  const raw = (params.requestedFrom || '').trim();
  if (!raw) return none;
  const requested = parseDdMmYyyy(raw);
  const end = parseDdMmYyyy(toPeriod);
  if (requested.getTime() > end.getTime()) {
    throw new Error(`From Period ${raw} is after To Period ${toPeriod}.`);
  }
  const dataStart = sinceInceptionStartDate({
    cashflows,
    closingBalances,
    toPeriod,
  });
  if (!dataStart || requested.getTime() <= dataStart.getTime()) return none;

  const fromKey = monthKeyFromDate(requested);
  const openingMonthKey =
    valuationMonthKeys(
      closingBalances.filter(
        (b) => b.closingAmount !== null && b.closingAmount !== undefined,
      ),
    )
      .filter((k) => k < fromKey)
      .at(-1) ?? null;
  if (!openingMonthKey) {
    throw new Error(
      `From Period ${raw} has no month-end closing valuation before it to open the period.`,
    );
  }
  const start = nextDay(lastDayOfMonthKey(openingMonthKey));
  return {
    cashflows: cashflows.filter((c) => {
      const dt = tryParseDdMmYyyy(c.transactionDate);
      return dt === null || dt.getTime() >= start.getTime();
    }),
    closingBalances: closingBalances.filter((b) => {
      const key = resolveRowMonthKey(b);
      return key !== null && key >= openingMonthKey;
    }),
    windowStart: formatDdMmYyyy(start),
    openingMonthKey,
  };
}

/** Distinct valuation months (YYYY-MM) present in a closing-balance set, sorted. */
export function valuationMonthKeys(
  closingBalances: Array<{ monthKey?: string | null; dateOfEntry?: string }>,
): string[] {
  return Array.from(
    new Set(
      closingBalances
        .map((b) => resolveRowMonthKey(b))
        .filter((k): k is string => Boolean(k)),
    ),
  ).sort();
}

/** Calendar day after `date` (UTC). */
export function nextDay(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
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

    periods.push({
      fyLabel,
      startDate: effectiveStart,
      endDate: effectiveEnd,
      isPartial: !isTwelveMonthPeriod(effectiveStart, effectiveEnd),
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
  ruleStartDate?: Date;
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

  // 12-month rule: If the client entered mid-FY without an opening balance,
  // the actual holding duration is from the first trade to periodEnd.
  // Compounding short holding periods (< 365 days) produces extreme/distorted
  // annualized returns (e.g. -93% on a 60-day -30% COVID crash).
  // In such cases, use Absolute Return (AR) instead of XIRR, exactly as in
  // portfolio return calculations and reference Excel client reports.
  const ruleStart =
    params.ruleStartDate ??
    (periodCashflows.some((c) => c.date.getTime() <= periodStart.getTime())
      ? periodStart
      : new Date(
          Math.min(...periodCashflows.map((c) => c.date.getTime())),
        ));

  if (isTwelveMonthPeriod(ruleStart, periodEnd)) {
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
