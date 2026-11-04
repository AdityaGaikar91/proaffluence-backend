import { BenchmarkCode } from '@prisma/client';
import {
  FetchLike,
  formatDdMmYyyy,
  HttpTimeoutError,
  IndexFeedProvider,
  IndexQuote,
  IndexSeriesType,
  ProviderFetchResult,
  parseFlexibleDate,
} from './index-feed.types';

/**
 * niftyindices.com historical TRI:
 *   POST /Backpage.aspx/getTotalReturnIndexString
 *
 * Documented body:
 *   { "cinfo": "{'name':'NIFTY 50','startDate':'01-Jan-2024','endDate':'31-Dec-2024','indexName':'NIFTY 50'}" }
 *
 * Success: `{ d: "<json-string>" }` → parse twice → rows with Date + TotalReturnsIndex/NTR_Value.
 *
 * Live probes (Nov 2026) from Nest hosts still return HTTP 302 → Sitefinity Login.
 * When disabled or gated, returns structured unavailable (never invents TRI from PR).
 */
export class NiftyIndicesTriProvider implements IndexFeedProvider {
  readonly name = 'niftyindices.com (TRI)';
  static readonly DEFAULT_BASE = 'https://www.niftyindices.com';
  static readonly HISTORICAL_PATH = '/reports/historical-data';
  static readonly TRI_PATH = '/Backpage.aspx/getTotalReturnIndexString';
  static readonly INDEX_NAME = 'NIFTY 50';
  /** Safety cap on calendar span per request. */
  static readonly MAX_RANGE_DAYS = 400;

  private static readonly MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ] as const;

  constructor(
    private readonly fetchImpl: FetchLike = fetch as FetchLike,
    private readonly opts: {
      timeoutMs?: number;
      retries?: number;
      baseUrl?: string;
      enabled?: boolean;
    } = {},
  ) {}

  static isEnabled(env = process.env): boolean {
    return (env.NIFTYINDICES_TRI_ENABLED || '').toLowerCase() === 'true';
  }

  getBase(): string {
    return (
      this.opts.baseUrl ||
      process.env.NIFTYINDICES_BASE_URL ||
      NiftyIndicesTriProvider.DEFAULT_BASE
    ).replace(/\/$/, '');
  }

  supports(code: BenchmarkCode): boolean {
    return code === BenchmarkCode.NIFTY_50_TRI;
  }

  seriesType(): IndexSeriesType {
    return 'TRI';
  }

  /** dd-MMM-yyyy for niftyindices cinfo (UTC calendar day). */
  static formatCinfoDate(d: Date): string {
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mon = NiftyIndicesTriProvider.MONTHS[d.getUTCMonth()];
    return `${dd}-${mon}-${d.getUTCFullYear()}`;
  }

  static buildCinfo(from: Date, to: Date, indexName = NiftyIndicesTriProvider.INDEX_NAME): string {
    const startDate = NiftyIndicesTriProvider.formatCinfoDate(from);
    const endDate = NiftyIndicesTriProvider.formatCinfoDate(to);
    return `{'name':'${indexName}','startDate':'${startDate}','endDate':'${endDate}','indexName':'${indexName}'}`;
  }

  /**
   * Parses ASP.NET `{ d: "..." }` payload into IndexQuote[].
   * Exported for unit tests / fixtures.
   */
  static parseTriResponse(body: string): IndexQuote[] {
    let outer: unknown;
    try {
      outer = JSON.parse(body);
    } catch {
      throw new Error('TRI response is not valid JSON');
    }
    if (!outer || typeof outer !== 'object') {
      throw new Error('TRI response missing object root');
    }
    const dVal = (outer as { d?: unknown }).d;
    if (dVal == null) throw new Error('TRI response missing d field');

    let rows: unknown = dVal;
    if (typeof dVal === 'string') {
      try {
        rows = JSON.parse(dVal);
      } catch {
        throw new Error('TRI d field is not a JSON-encoded string');
      }
      // Some payloads nest another encoded string
      if (typeof rows === 'string') {
        try {
          rows = JSON.parse(rows);
        } catch {
          throw new Error('TRI d field failed second JSON parse');
        }
      }
    }
    if (!Array.isArray(rows)) {
      throw new Error('TRI d field did not decode to an array');
    }

    const quotes: IndexQuote[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const rawDate = String(rec.Date ?? rec.date ?? '').trim();
      const rawLevel =
        rec.TotalReturnsIndex ??
        rec.NTR_Value ??
        rec.totalReturnsIndex ??
        rec.ntr_Value;
      if (!rawDate || rawLevel == null || rawLevel === '') continue;

      const parsedDate =
        parseFlexibleDate(rawDate) ||
        NiftyIndicesTriProvider.parseLooseDate(rawDate);
      if (!parsedDate) continue;

      const closingValue = Number(String(rawLevel).replace(/,/g, ''));
      if (!Number.isFinite(closingValue)) {
        throw new Error(`Invalid TRI closing value "${rawLevel}" for ${rawDate}`);
      }
      quotes.push({ date: formatDdMmYyyy(parsedDate), closingValue });
    }
    return quotes;
  }

  /** Accepts dd-MMM-yyyy and similar browser formats. */
  static parseLooseDate(raw: string): Date | null {
    const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
    if (!m) return null;
    const day = Number(m[1]);
    const monIdx = NiftyIndicesTriProvider.MONTHS.findIndex(
      (x) => x.toLowerCase() === m[2].toLowerCase(),
    );
    const year = Number(m[3]);
    if (monIdx < 0) return null;
    const dt = new Date(Date.UTC(year, monIdx, day));
    if (
      dt.getUTCFullYear() !== year ||
      dt.getUTCMonth() !== monIdx ||
      dt.getUTCDate() !== day
    ) {
      return null;
    }
    return dt;
  }

  async fetchRange(
    code: BenchmarkCode,
    from: Date,
    to: Date,
  ): Promise<ProviderFetchResult> {
    if (!this.supports(code)) {
      return {
        ok: false,
        provider: this.name,
        reason: `${this.name} does not support ${code}`,
      };
    }

    const enabled =
      this.opts.enabled !== undefined
        ? this.opts.enabled
        : NiftyIndicesTriProvider.isEnabled();
    if (!enabled) {
      return {
        ok: false,
        provider: this.name,
        reason:
          'Nifty 50 TRI feed disabled (set NIFTYINDICES_TRI_ENABLED=true). Endpoint often requires Sitefinity login — enter TRI manually/bulk, or use NIFTY_50_PR (price-only, labelled) as fallback.',
      };
    }

    const spanDays =
      Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (spanDays > NiftyIndicesTriProvider.MAX_RANGE_DAYS) {
      return {
        ok: false,
        provider: this.name,
        reason: `Requested range ${spanDays} days exceeds max ${NiftyIndicesTriProvider.MAX_RANGE_DAYS}`,
      };
    }

    const base = this.getBase();
    const histUrl = `${base}${NiftyIndicesTriProvider.HISTORICAL_PATH}`;
    const triUrl = `${base}${NiftyIndicesTriProvider.TRI_PATH}`;
    const timeoutMs = this.opts.timeoutMs ?? 15000;
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    try {
      const cookieJar = await this.bootstrapCookies(histUrl, ua, timeoutMs);
      const body = JSON.stringify({
        cinfo: NiftyIndicesTriProvider.buildCinfo(from, to),
      });

      const res = await this.postJson(triUrl, {
        body,
        cookieJar,
        ua,
        timeoutMs,
        referer: histUrl,
      });

      if (res.status === 302 || res.status === 301) {
        return {
          ok: false,
          provider: this.name,
          reason: `niftyindices.com TRI endpoint redirected to login (HTTP ${res.status}). Enter TRI manually/bulk, or use NIFTY_50_PR (price-only, labelled) as fallback.`,
        };
      }
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          provider: this.name,
          reason: `niftyindices.com TRI endpoint unauthorized (HTTP ${res.status}). Manual/bulk IndicesData required.`,
        };
      }
      if (res.status < 200 || res.status >= 300) {
        return {
          ok: false,
          provider: this.name,
          reason: `niftyindices.com TRI HTTP ${res.status}`,
        };
      }

      const quotes = NiftyIndicesTriProvider.parseTriResponse(res.body);
      return {
        ok: true,
        provider: this.name,
        seriesType: 'TRI',
        sourceUrl: triUrl,
        quotes,
      };
    } catch (err) {
      const reason =
        err instanceof HttpTimeoutError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return { ok: false, provider: this.name, reason };
    }
  }

  private async bootstrapCookies(
    histUrl: string,
    ua: string,
    timeoutMs: number,
  ): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(histUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': ua,
        },
        signal: ctrl.signal,
        redirect: 'follow',
      } as Parameters<FetchLike>[1]);
      const setCookie = this.readSetCookie(res);
      return setCookie;
    } catch (err) {
      if (ctrl.signal.aborted) {
        throw new HttpTimeoutError(`Timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async postJson(
    url: string,
    opts: {
      body: string;
      cookieJar: string;
      ua: string;
      timeoutMs: number;
      referer: string;
    },
  ): Promise<{ status: number; body: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: this.getBase(),
        Referer: opts.referer,
        'User-Agent': opts.ua,
      };
      if (opts.cookieJar) headers.Cookie = opts.cookieJar;

      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: opts.body,
        signal: ctrl.signal,
        redirect: 'manual',
      } as Parameters<FetchLike>[1]);
      const body = await res.text();
      return { status: res.status, body };
    } catch (err) {
      if (ctrl.signal.aborted) {
        throw new HttpTimeoutError(`Timed out after ${opts.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private readSetCookie(res: {
    headers?: { get?(name: string): string | null; raw?(): Record<string, string[]> };
  }): string {
    try {
      const get = res.headers?.get?.bind(res.headers);
      if (get) {
        const single = get('set-cookie');
        if (single) return single.split(';')[0];
      }
    } catch {
      /* ignore */
    }
    return '';
  }
}
