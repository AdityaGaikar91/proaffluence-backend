import { BenchmarkCode } from '@prisma/client';
import {
  IndexFeedProvider,
  IndexSeriesType,
  ProviderFetchResult,
} from './index-feed.types';

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
