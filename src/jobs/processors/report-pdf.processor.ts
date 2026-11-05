import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createHash } from 'crypto';
import { QUEUE_REPORT_PDF } from '../job.constants';
import { ReportsService } from '../../reports/reports.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ReportingFreezeService } from '../../core/reporting/reporting-freeze.service';

@Processor(QUEUE_REPORT_PDF, {
  concurrency: Number(process.env.LIBREOFFICE_CONCURRENCY || 1),
})
export class ReportPdfProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportPdfProcessor.name);

  constructor(
    private readonly reportsService: ReportsService,
    private readonly prisma: PrismaService,
    private readonly freezeService: ReportingFreezeService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const { groupHeadId, period, encrypted, userId, userName } = job.data as {
      groupHeadId: string;
      period: string;
      encrypted: boolean;
      userId: string;
      userName: string;
    };
    this.logger.log(`PDF job ${job.id} gh=${groupHeadId} encrypted=${encrypted}`);
    if (encrypted) {
      await this.freezeService.assertPeriodFrozenForDispatch(period);
    }

    const pdf = await this.reportsService.generateClientPdf({
      groupHeadId,
      period,
      encrypted,
    });

    const monthKey = ReportingFreezeService.deriveMonthKey(period);
    const sha = createHash('sha256').update(pdf.buffer).digest('hex');
    const fingerprint = createHash('sha256')
      .update(`${groupHeadId}|${period}|${sha}`)
      .digest('hex')
      .slice(0, 32);

    await this.prisma.reportArtifact.upsert({
      where: {
        groupHeadId_period_inputFingerprint: {
          groupHeadId,
          period,
          inputFingerprint: fingerprint,
        },
      },
      create: {
        groupHeadId,
        period,
        monthKey,
        inputFingerprint: fingerprint,
        calcJson: { dashboardPeriod: period },
        pdfPath: pdf.filePath,
        pdfSha256: sha,
        engine: pdf.engine,
        needsReview: pdf.needsReview,
        jobId: String(job.id),
        createdById: userId,
        createdByName: userName,
      },
      update: {
        pdfPath: pdf.filePath,
        pdfSha256: sha,
        engine: pdf.engine,
        needsReview: pdf.needsReview,
        jobId: String(job.id),
      },
    });

    return {
      status: 'completed',
      engine: pdf.engine,
      needsReview: pdf.needsReview,
      pdfSha256: sha,
      filePath: pdf.filePath,
    };
  }
}
