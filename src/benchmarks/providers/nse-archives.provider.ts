import { BenchmarkCode } from '@prisma/client';
import {
  FetchLike,
  IndexFeedProvider,
  IndexQuote,
  IndexSeriesType,
  ProviderFetchResult,
  formatDdMmYyyy,
  httpGetText,
} from './index-feed.types';

/**
 * NSE public daily index closing file (free, no login):
 *   https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv
 * Verified 03-11-2026 from the dev Mac: HTTP 200 on trading days, 404 on
 * weekends/holidays. Contains the Nifty 50 PRICE index ("Nifty 50" row,
 * "Closing Index Value" column). It does NOT contain Nifty 50 TRI, so this
 * provider only serves NIFTY_50_PR.
 */
export class NseArchivesProvider implements IndexFeedProvider {
  readonly name = 'NSE Archives (ind_close_all CSV)';
  static readonly DEFAULT_BASE =
    'https://nsearchives.nseindia.com/content/indices/ind_close_all_';
  private static readonly ROW_NAME: Partial<Record<BenchmarkCode, string>> = {
    [BenchmarkCode.NIFTY_50_PR]: 'nifty 50',
  };
  /** Safety cap on calendar days scanned per request. */
  static readonly MAX_RANGE_DAYS = 400;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly opts: {
      timeoutMs?: number;
      retries?: number;
      baseUrl?: string;
    } = {},
  ) {}

  /** Resolved archives CSV URL prefix (env NSE_ARCHIVES_BASE_URL or default). */
  getBase(): string {
    return (
      this.opts.baseUrl ||
      process.env.NSE_ARCHIVES_BASE_URL ||
      NseArchivesProvider.DEFAULT_BASE
    );
  }

  supports(code: BenchmarkCode): boolean {
    return code in NseArchivesProvider.ROW_NAME;
  }

  seriesType(): IndexSeriesType {
    return 'PRICE';
  }

  static urlFor(
    date: Date,
    baseUrl = process.env.NSE_ARCHIVES_BASE_URL ||
      NseArchivesProvider.DEFAULT_BASE,
  ): string {
    const [dd, mm, yyyy] = formatDdMmYyyy(date).split('-');
    return `${baseUrl}${dd}${mm}${yyyy}.csv`;
  }

  /** Extracts the closing value for `rowName` from the CSV. Throws on malformed payload. */
  static parseClosing(csv: string, rowName: string): number | null {
    const lines = csv
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter(Boolean);
    if (lines.length < 2) throw new Error('CSV has no data rows');
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const nameIdx = header.indexOf('index name');
    const closeIdx = header.indexOf('closing index value');
    if (nameIdx < 0 || closeIdx < 0) {
      throw new Error(
        'Unexpected CSV header (missing Index Name / Closing Index Value)',
      );
    }
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      if ((cols[nameIdx] ?? '').trim().toLowerCase() === rowName) {
        const v = Number((cols[closeIdx] ?? '').trim());
        if (!Number.isFinite(v) || v <= 0) {
          throw new Error(`Invalid closing value "${cols[closeIdx]}"`);
        }
        return v;
      }
    }
    return null;
  }

  async fetchRange(
    code: BenchmarkCode,
    from: Date,
    to: Date,
  ): Promise<ProviderFetchResult> {
    const rowName = NseArchivesProvider.ROW_NAME[code];
    if (!rowName) {
      return {
        ok: false,
        provider: this.name,
        reason: `${code} is not published in the NSE ind_close_all file.`,
      };
    }
    const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    if (days <= 0 || days > NseArchivesProvider.MAX_RANGE_DAYS) {
      return {
        ok: false,
        provider: this.name,
        reason: `Range must be 1-${NseArchivesProvider.MAX_RANGE_DAYS} days.`,
      };
    }

    const quotes: IndexQuote[] = [];
    const errors: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from.getTime() + i * 86400000);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue; // no file on weekends
      const url = NseArchivesProvider.urlFor(d, this.getBase());
      try {
        const res = await httpGetText(this.fetchImpl, url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
            Accept: 'text/csv,*/*',
          },
          timeoutMs: this.opts.timeoutMs ?? 10000,
          retries: this.opts.retries ?? 2,
        });
        if (res.status === 404) continue; // market holiday: no file
        if (res.status !== 200) {
          errors.push(`${formatDdMmYyyy(d)}: HTTP ${res.status}`);
          continue;
        }
        const v = NseArchivesProvider.parseClosing(res.body, rowName);
        if (v === null) {
          errors.push(`${formatDdMmYyyy(d)}: "${rowName}" row not found`);
          continue;
        }
        quotes.push({ date: formatDdMmYyyy(d), closingValue: v });
      } catch (err) {
        errors.push(`${formatDdMmYyyy(d)}: ${(err as Error).message}`);
      }
    }

    if (errors.length > 0 && quotes.length === 0) {
      return {
        ok: false,
        provider: this.name,
        reason: errors.slice(0, 3).join('; '),
      };
    }
    return {
      ok: true,
      provider: this.name,
      seriesType: 'PRICE',
      sourceUrl: `${this.getBase()}DDMMYYYY.csv`,
      quotes,
    };
  }
}
