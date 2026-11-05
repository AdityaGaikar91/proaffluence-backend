import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createHash } from 'crypto';
import { QUEUE_REPORT_CALCULATE } from '../job.constants';
import { ReportsService } from '../../reports/reports.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ReportingFreezeService } from '../../core/reporting/reporting-freeze.service';

@Processor(QUEUE_REPORT_CALCULATE, { concurrency: 2 })
export class ReportCalculateProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportCalculateProcessor.name);

  constructor(
    private readonly reportsService: ReportsService,
    private readonly prisma: PrismaService,
    private readonly freezeService: ReportingFreezeService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const { period, groupHeadId, userId, userName } = job.data as {
      period: string;
      groupHeadId: string;
      userId: string;
      userName: string;
    };
    this.logger.log(`Calculate job ${job.id} period=${period} gh=${groupHeadId}`);
    await this.freezeService.assertPeriodFrozenForDispatch(period);

    const result = await this.reportsService.executeCalculationRun(
      { period, groupHeadId },
      { id: userId, name: userName },
    );

    const monthKey = ReportingFreezeService.deriveMonthKey(period);
    const run = await this.prisma.reportingRun.findUnique({
      where: { period },
    });
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          period,
          groupHeadId,
          summary: result.summary,
        }),
      )
      .digest('hex')
      .slice(0, 32);

    await this.prisma.reportArtifact.upsert({
      where: {
        groupHeadId_period_inputFingerprint: {
          groupHeadId: groupHeadId === 'All' ? 'ALL' : groupHeadId,
          period,
          inputFingerprint: fingerprint,
        },
      },
      create: {
        groupHeadId: groupHeadId === 'All' ? 'ALL' : groupHeadId,
        period,
        monthKey,
        reportingRunId: run?.id,
        inputFingerprint: fingerprint,
        calcJson: result as object,
        engine: 'o-template-ts',
        needsReview: false,
        jobId: String(job.id),
        createdById: userId,
        createdByName: userName,
      },
      update: {
        calcJson: result as object,
        jobId: String(job.id),
      },
    });

    return { status: 'completed', fingerprint, summary: result.summary };
  }
}
