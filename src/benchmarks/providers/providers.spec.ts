import { BenchmarkCode } from '@prisma/client';
import { NseArchivesProvider } from './nse-archives.provider';
import {
  BseIndiaProvider,
  NiftyIndicesTriProvider,
} from './unavailable.providers';
import {
  FetchLike,
  lastCompletedMonthEnd,
  parseFlexibleDate,
} from './index-feed.types';

const CSV = [
  'Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield',
  'Nifty 50,31-10-2025,25863.8,25953.75,25711.2,25722.1,-155.75,-.6,334384400,28788.4,22.64,3.52,1.29',
  'Nifty Next 50,31-10-2025,70172.65,70289.35,69769.3,69824.75,-257.8,-.37,1,1,1,1,1',
].join('\n');

const d = (s: string) => parseFlexibleDate(s)!;
const fetchReturning =
  (fn: (url: string) => { status: number; body: string } | Error): FetchLike =>
  (url) => {
    const r = fn(url);
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve({
      status: r.status,
      text: () => Promise.resolve(r.body),
    });
  };

describe('NseArchivesProvider', () => {
  it('parses the Nifty 50 closing level (PRICE series) on success', async () => {
    const p = new NseArchivesProvider(
      fetchReturning(() => ({ status: 200, body: CSV })),
    );
    const res = await p.fetchRange(
      BenchmarkCode.NIFTY_50_PR,
      d('31-10-2025'),
      d('31-10-2025'),
    );
    expect(res).toMatchObject({
      ok: true,
      seriesType: 'PRICE',
      quotes: [{ date: '31-10-2025', closingValue: 25722.1 }],
    });
  });

  it('builds the archive URL from the date', () => {
    expect(NseArchivesProvider.urlFor(d('31-10-2025'))).toBe(
      'https://nsearchives.nseindia.com/content/indices/ind_close_all_31102025.csv',
    );
  });

  it('falls back to the last trading day on/before month-end (weekend/holiday 404s)', async () => {
    const urls: string[] = [];
    const p = new NseArchivesProvider(
      fetchReturning((url) => {
        urls.push(url);
        return url.includes('30102025')
          ? { status: 200, body: CSV.replace(/31-10-2025/g, '30-10-2025') }
          : { status: 404, body: '' };
      }),
    );
    const res = await p.fetchRange(
      BenchmarkCode.NIFTY_50_PR,
      d('29-10-2025'),
      d('02-11-2025'),
    );
    expect(res.ok && res.quotes).toEqual([
      { date: '30-10-2025', closingValue: 25722.1 },
    ]);
    expect(urls.some((u) => u.includes('01112025'))).toBe(false); // Saturday skipped
  });

  it('returns unavailable on malformed payload', async () => {
    const p = new NseArchivesProvider(
      fetchReturning(() => ({
        status: 200,
        body: '<html>blocked</html>\nfoo',
      })),
    );
    const res = await p.fetchRange(
      BenchmarkCode.NIFTY_50_PR,
      d('31-10-2025'),
      d('31-10-2025'),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Unexpected CSV header/);
  });

  it('rejects non-numeric closing values instead of storing them', () => {
    expect(() =>
      NseArchivesProvider.parseClosing(
        CSV.replace('25722.1', 'abc'),
        'nifty 50',
      ),
    ).toThrow(/Invalid closing value/);
  });

  it('returns unavailable with reason on 4xx (e.g. 403)', async () => {
    const p = new NseArchivesProvider(
      fetchReturning(() => ({ status: 403, body: 'denied' })),
      { retries: 0 },
    );
    const res = await p.fetchRange(
      BenchmarkCode.NIFTY_50_PR,
      d('31-10-2025'),
      d('31-10-2025'),
    );
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.reason).toContain('HTTP 403');
  });

  it('returns unavailable on timeout', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      );
    const p = new NseArchivesProvider(hanging, { timeoutMs: 20, retries: 0 });
    const res = await p.fetchRange(
      BenchmarkCode.NIFTY_50_PR,
      d('31-10-2025'),
      d('31-10-2025'),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Timed out/);
  });

  it('retries on 5xx then succeeds', async () => {
    let n = 0;
    const p = new NseArchivesProvider(
      fetchReturning(() =>
        ++n === 1 ? { status: 503, body: '' } : { status: 200, body: CSV },
      ),
      { retries: 1 },
    );
    const res = await p.fetchRange(
      BenchmarkCode.NIFTY_50_PR,
      d('31-10-2025'),
      d('31-10-2025'),
    );
    expect(res.ok).toBe(true);
    expect(n).toBe(2);
  });

  it('returns ok with empty quotes when no trading day in range (empty data)', async () => {
    const p = new NseArchivesProvider(
      fetchReturning(() => ({ status: 404, body: '' })),
    );
    const res = await p.fetchRange(
      BenchmarkCode.NIFTY_50_PR,
      d('01-11-2025'),
      d('02-11-2025'),
    );
    expect(res).toMatchObject({ ok: true, quotes: [] });
  });

  it('does not serve TRI (never relabels price as TRI)', () => {
    const p = new NseArchivesProvider();
    expect(p.supports(BenchmarkCode.NIFTY_50_TRI)).toBe(false);
    expect(p.supports(BenchmarkCode.NIFTY_50_PR)).toBe(true);
  });
});

describe('unconfirmed providers', () => {
  it('niftyindices TRI and BSE report unavailable with reason', async () => {
    const tri = await new NiftyIndicesTriProvider().fetchRange();
    const bse = await new BseIndiaProvider().fetchRange(BenchmarkCode.SENSEX);
    expect(tri.ok).toBe(false);
    expect(bse.ok).toBe(false);
  });
});

describe('date helpers', () => {
  it('computes last completed month-end in IST', () => {
    expect(
      lastCompletedMonthEnd(new Date('2026-11-03T06:00:00Z'))
        .toISOString()
        .slice(0, 10),
    ).toBe('2026-10-31');
    expect(
      lastCompletedMonthEnd(new Date('2026-03-01T00:00:00+05:30'))
        .toISOString()
        .slice(0, 10),
    ).toBe('2026-02-28');
  });
  it('rejects impossible dates', () => {
    expect(parseFlexibleDate('31-02-2026')).toBeNull();
    expect(parseFlexibleDate('2026-10-31')?.toISOString().slice(0, 10)).toBe(
      '2026-10-31',
    );
  });
});
