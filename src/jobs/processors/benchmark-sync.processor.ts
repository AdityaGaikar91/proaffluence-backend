import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_BENCHMARK_SYNC } from '../job.constants';
import { BenchmarksService } from '../../benchmarks/benchmarks.service';

@Processor(QUEUE_BENCHMARK_SYNC, { concurrency: 1 })
export class BenchmarkSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(BenchmarkSyncProcessor.name);

  constructor(private readonly benchmarksService: BenchmarksService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const { periodDate } = (job.data || {}) as { periodDate?: string };
    this.logger.log(`Benchmark sync job ${job.id} periodDate=${periodDate || 'default'}`);
    return this.benchmarksService.syncFeed(
      { periodDate },
      'Benchmark Sync Worker',
    );
  }
}
