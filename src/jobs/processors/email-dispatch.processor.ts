import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_EMAIL_DISPATCH } from '../job.constants';
import { CommunicationsService } from '../../communications/communications.service';

/** ~10 emails/min: concurrency 1 + limiter max 10 / 60s */
@Processor(QUEUE_EMAIL_DISPATCH, {
  concurrency: 1,
  limiter: { max: 10, duration: 60_000 },
})
export class EmailDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailDispatchProcessor.name);

  constructor(private readonly communicationsService: CommunicationsService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const { reportDate, groupHeadIds, userId, userName } = job.data as {
      reportDate: string;
      groupHeadIds: string[];
      userId: string;
      userName: string;
    };
    this.logger.log(
      `Email dispatch job ${job.id} count=${groupHeadIds.length} date=${reportDate}`,
    );
    return this.communicationsService.sendCampaigns(
      { reportDate, groupHeadIds },
      { id: userId, name: userName },
    );
  }
}
