import { BenchmarkCode } from '@prisma/client';
import {
  IndexFeedProvider,
  IndexSeriesType,
  ProviderFetchResult,
} from './index-feed.types';

/**
 * niftyindices.com historical TRI data
 * (POST /Backpage.aspx/getTotalReturnIndexString). Probed 03-11-2026 from the
 * dev Mac with session cookie + Referer + XHR headers: HTTP 302 redirect to
 * /Sitefinity/Login, i.e. the endpoint now requires a login. No free TRI feed
 * was confirmed, so this provider reports "unavailable" and never guesses.
 */
export class NiftyIndicesTriProvider implements IndexFeedProvider {
  readonly name = 'niftyindices.com (TRI)';
  supports(code: BenchmarkCode): boolean {
    return code === BenchmarkCode.NIFTY_50_TRI;
  }
  seriesType(): IndexSeriesType {
    return 'TRI';
  }
  fetchRange(): Promise<ProviderFetchResult> {
    return Promise.resolve({
      ok: false,
      provider: this.name,
      reason:
        'No confirmed free Nifty 50 TRI feed: niftyindices.com historical TRI endpoint redirects to login (HTTP 302). Enter TRI manually, or use NIFTY_50_PR (price-only, labelled) as fallback.',
    });
  }
}

/**
 * api.bseindia.com (IndexArchDaily / ProduceCSVForDate). Probed 03-11-2026 from
 * the dev Mac: Akamai "Access Denied" (HTTP 403) even with bseindia.com cookies
 * and Referer. No free BSE feed confirmed.
 */
export class BseIndiaProvider implements IndexFeedProvider {
  readonly name = 'bseindia.com';
  supports(code: BenchmarkCode): boolean {
    return code === BenchmarkCode.SENSEX || code === BenchmarkCode.BSE_500;
  }
  seriesType(): IndexSeriesType {
    return 'PRICE';
  }
  fetchRange(code: BenchmarkCode): Promise<ProviderFetchResult> {
    return Promise.resolve({
      ok: false,
      provider: this.name,
      reason: `No confirmed free ${code} feed: api.bseindia.com returns HTTP 403 (Access Denied) to server requests. Enter the closing level manually.`,
    });
  }
}
