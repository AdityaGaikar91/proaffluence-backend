import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_BENCHMARK_SYNC,
  QUEUE_EMAIL_DISPATCH,
  QUEUE_REPORT_CALCULATE,
  QUEUE_REPORT_PDF,
} from './job.constants';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectQueue(QUEUE_REPORT_CALCULATE) private readonly calcQueue: Queue,
    @InjectQueue(QUEUE_REPORT_PDF) private readonly pdfQueue: Queue,
    @InjectQueue(QUEUE_EMAIL_DISPATCH) private readonly emailQueue: Queue,
    @InjectQueue(QUEUE_BENCHMARK_SYNC) private readonly benchQueue: Queue,
  ) {}

  async enqueueCalculate(params: {
    period: string;
    groupHeadId: string;
    userId: string;
    userName: string;
  }) {
    const job = await this.calcQueue.add('calculate', params, {
      jobId: `calc:${params.period}:${params.groupHeadId}:${Date.now()}`,
    });
    this.logger.log(`Enqueued calculate job ${job.id}`);
    return { jobId: job.id, queue: QUEUE_REPORT_CALCULATE };
  }

  async enqueuePdf(params: {
    groupHeadId: string;
    period: string;
    encrypted: boolean;
    userId: string;
    userName: string;
  }) {
    const job = await this.pdfQueue.add('pdf', params, {
      jobId: `pdf:${params.period}:${params.groupHeadId}:${Date.now()}`,
    });
    return { jobId: job.id, queue: QUEUE_REPORT_PDF };
  }

  async enqueueEmailDispatch(params: {
    reportDate: string;
    groupHeadIds: string[];
    userId: string;
    userName: string;
  }) {
    const job = await this.emailQueue.add('dispatch', params, {
      jobId: `email:${params.reportDate}:${Date.now()}`,
    });
    return { jobId: job.id, queue: QUEUE_EMAIL_DISPATCH };
  }

  async enqueueBenchmarkSync(params: { periodDate?: string } = {}) {
    const job = await this.benchQueue.add(
      'sync',
      params,
      {
        jobId: `bench-sync:${new Date().toISOString().slice(0, 10)}`,
        // One logical run per day — BullMQ dedupes same jobId while active/completed retention
      },
    );
    return { jobId: job.id, queue: QUEUE_BENCHMARK_SYNC };
  }

  async getJobStatus(queueName: string, jobId: string) {
    const queue = this.resolveQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) return { found: false };
    const state = await job.getState();
    return {
      found: true,
      id: job.id,
      name: job.name,
      state,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn,
    };
  }

  private resolveQueue(name: string): Queue {
    switch (name) {
      case QUEUE_REPORT_CALCULATE:
        return this.calcQueue;
      case QUEUE_REPORT_PDF:
        return this.pdfQueue;
      case QUEUE_EMAIL_DISPATCH:
        return this.emailQueue;
      case QUEUE_BENCHMARK_SYNC:
        return this.benchQueue;
      default:
        return this.calcQueue;
    }
  }
}
