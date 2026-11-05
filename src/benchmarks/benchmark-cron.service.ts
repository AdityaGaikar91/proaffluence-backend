import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BenchmarksService } from './benchmarks.service';

/**
 * Daily TRI/PR feed sync (one run per day). Failures are logged; send path
 * still relies on preflight freshness checks.
 */
@Injectable()
export class BenchmarkCronService {
  private readonly logger = new Logger(BenchmarkCronService.name);

  constructor(private readonly benchmarksService: BenchmarksService) {}

  @Cron(CronExpression.EVERY_DAY_AT_6PM, {
    name: 'daily-benchmark-sync',
    timeZone: 'Asia/Kolkata',
  })
  async handleDailySync() {
    if (process.env.BENCHMARK_CRON_ENABLED === 'false') {
      return;
    }
    this.logger.log('Starting scheduled benchmark feed sync');
    try {
      const result = await this.benchmarksService.syncFeed(
        {},
        'Scheduled Benchmark Cron',
      );
      this.logger.log(
        `Benchmark cron finished status=${result.status} synced=${result.syncedCount}`,
      );
    } catch (err: any) {
      this.logger.error(`Benchmark cron failed: ${err?.message || err}`);
    }
  }
}
