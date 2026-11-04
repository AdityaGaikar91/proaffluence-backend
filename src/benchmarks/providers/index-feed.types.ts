import { BenchmarkCode } from '@prisma/client';

/** Honest label of what a series actually measures. Never relabel PR as TRI. */
export type IndexSeriesType = 'TRI' | 'PRICE';

export interface IndexQuote {
  /** Trading date the closing level belongs to, dd-MM-yyyy. */
  date: string;
  closingValue: number;
}

export type ProviderFetchResult =
  | {
      ok: true;
      provider: string;
      seriesType: IndexSeriesType;
      sourceUrl: string;
      quotes: IndexQuote[];
    }
  | { ok: false; provider: string; reason: string };

export interface IndexFeedProvider {
  readonly name: string;
  supports(code: BenchmarkCode): boolean;
  /** Series type this provider delivers for the given code. */
  seriesType(code: BenchmarkCode): IndexSeriesType;
  /**
   * Fetch closing levels between from/to (inclusive). Never invents data:
   * dates with no published level are simply absent from `quotes`.
   */
  fetchRange(
    code: BenchmarkCode,
    from: Date,
    to: Date,
  ): Promise<ProviderFetchResult>;
}

export const INDEX_FEED_PROVIDERS = Symbol('INDEX_FEED_PROVIDERS');

export function formatDdMmYyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

/** Parses dd-MM-yyyy or yyyy-MM-dd into a UTC-midnight Date; null if invalid. */
export function parseFlexibleDate(raw: string): Date | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (match) {
    d = +match[1];
    m = +match[2];
    y = +match[3];
  } else {
    match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!match) return null;
    y = +match[1];
    m = +match[2];
    d = +match[3];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

/** Last calendar day of the month before `now` (IST), e.g. 03-11-2026 -> 31-10-2026. */
export function lastCompletedMonthEnd(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 0));
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export class HttpTimeoutError extends Error {}

/** GET with timeout + retries on network errors / 5xx / 429 only. */
export async function httpGetText(
  fetchImpl: FetchLike,
  url: string,
  opts: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
  } = {},
): Promise<{ status: number; body: string }> {
  const { headers, timeoutMs = 10000, retries = 2, retryDelayMs = 500 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers, signal: ctrl.signal });
      const body = await res.text();
      if ((res.status >= 500 || res.status === 429) && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return { status: res.status, body };
      }
    } catch (err) {
      lastErr = ctrl.signal.aborted
        ? new HttpTimeoutError(`Timed out after ${timeoutMs}ms`)
        : err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
