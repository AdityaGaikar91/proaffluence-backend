import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JobsService } from './jobs.service';

@ApiTags('Jobs (BullMQ)')
@ApiCookieAuth('proaffluence.session_token')
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1/jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post('calculate')
  @Roles('manager', 'super_admin')
  @ApiOperation({ summary: 'Enqueue O_Template calculation job (async)' })
  enqueueCalculate(
    @Body() body: { period: string; groupHeadId: string },
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.jobsService.enqueueCalculate({
      period: body.period || '30-09-2026',
      groupHeadId: body.groupHeadId || 'All',
      userId: user.id,
      userName: user.name || 'Manager',
    });
  }

  @Post('pdf')
  @Roles('manager', 'super_admin')
  @ApiOperation({ summary: 'Enqueue client PDF generation job' })
  enqueuePdf(
    @Body()
    body: { groupHeadId: string; period?: string; encrypted?: boolean },
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.jobsService.enqueuePdf({
      groupHeadId: body.groupHeadId,
      period: body.period || '30-09-2026',
      encrypted: body.encrypted ?? true,
      userId: user.id,
      userName: user.name || 'Manager',
    });
  }

  @Post('email-dispatch')
  @Roles('manager', 'super_admin')
  @ApiOperation({ summary: 'Enqueue approved campaign email dispatch' })
  enqueueEmail(
    @Body() body: { reportDate?: string; groupHeadIds: string[] },
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.jobsService.enqueueEmailDispatch({
      reportDate: body.reportDate || '30-09-2026',
      groupHeadIds: body.groupHeadIds || [],
      userId: user.id,
      userName: user.name || 'Manager',
    });
  }

  @Post('benchmark-sync')
  @Roles('manager', 'super_admin')
  @ApiOperation({ summary: 'Enqueue daily benchmark feed sync' })
  enqueueBench(@Body() body: { periodDate?: string }) {
    return this.jobsService.enqueueBenchmarkSync(body || {});
  }

  @Get(':queue/:jobId')
  @ApiOperation({ summary: 'Poll job status by queue name and job id' })
  getStatus(@Param('queue') queue: string, @Param('jobId') jobId: string) {
    return this.jobsService.getJobStatus(queue, jobId);
  }
}
