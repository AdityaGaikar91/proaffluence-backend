import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ReportsModule } from '../reports/reports.module';
import { CommunicationsModule } from '../communications/communications.module';
import { BenchmarksModule } from '../benchmarks/benchmarks.module';
import { PrismaModule } from '../core/prisma/prisma.module';
import {
  QUEUE_BENCHMARK_SYNC,
  QUEUE_EMAIL_DISPATCH,
  QUEUE_REPORT_CALCULATE,
  QUEUE_REPORT_PDF,
} from './job.constants';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { ReportCalculateProcessor } from './processors/report-calculate.processor';
import { ReportPdfProcessor } from './processors/report-pdf.processor';
import { EmailDispatchProcessor } from './processors/email-dispatch.processor';
import { BenchmarkSyncProcessor } from './processors/benchmark-sync.processor';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    forwardRef(() => ReportsModule),
    forwardRef(() => CommunicationsModule),
    BenchmarksModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', '127.0.0.1'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: null,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_REPORT_CALCULATE },
      { name: QUEUE_REPORT_PDF },
      {
        name: QUEUE_EMAIL_DISPATCH,
        // Outbound email ramp: ~10/min via worker concurrency + limiter
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
        },
      },
      { name: QUEUE_BENCHMARK_SYNC },
    ),
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    ReportCalculateProcessor,
    ReportPdfProcessor,
    EmailDispatchProcessor,
    BenchmarkSyncProcessor,
  ],
  exports: [JobsService, BullModule],
})
export class JobsModule {}
