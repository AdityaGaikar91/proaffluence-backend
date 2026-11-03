import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CommunicationsService } from './communications.service';
import {
  CampaignBatchActionDto,
  RerouteDeliveryLogDto,
} from './dto/communications.dto';

@ApiTags('Communications, Email Preview & Dispatch Hub')
@ApiCookieAuth('proaffluence.session_token')
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1/communications')
export class CommunicationsController {
  constructor(private readonly communicationsService: CommunicationsService) {}

  @Get('campaigns')
  @ApiOperation({
    summary:
      'List all Group Head email campaigns, merge fields, delivery logs, and SMTP provider warming status',
  })
  listCampaigns(@Query('reportDate') reportDate?: string) {
    return this.communicationsService.listCampaignsAndOverview(reportDate);
  }

  @Get('logs')
  @ApiOperation({
    summary: 'List all outbound email delivery and bounce logs',
  })
  listLogs() {
    return this.communicationsService.listDeliveryLogs();
  }

  @Post('campaigns/mark-ready')
  @ApiOperation({
    summary:
      'Mark single or batch client email campaigns as Ready after Staff preview',
  })
  markReady(@Body() dto: CampaignBatchActionDto) {
    return this.communicationsService.markReady(dto);
  }

  @Post('campaigns/approve')
  @Roles('manager', 'super_admin')
  @ApiOperation({
    summary:
      'Manager Maker-Checker approval gate for client email campaigns (Manager/Admin only)',
  })
  approveCampaigns(
    @Body() dto: CampaignBatchActionDto,
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.communicationsService.approveCampaigns(dto, {
      id: user.id,
      name: user.name || 'Operations Manager',
    });
  }

  @Post('send')
  @Roles('manager', 'super_admin')
  @ApiOperation({
    summary:
      'Dispatch approved client report emails with PAN-encrypted PDF attachments (Manager/Admin only)',
  })
  sendCampaigns(
    @Body() dto: CampaignBatchActionDto,
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.communicationsService.sendCampaigns(dto, {
      id: user.id,
      name: user.name || 'Operations Manager',
    });
  }

  @Post('logs/:id/retry')
  @Roles('manager', 'super_admin')
  @ApiOperation({
    summary: 'Retry a failed or bounced email delivery log',
  })
  retryFailedLog(
    @Param('id') id: string,
    @Body() dto?: RerouteDeliveryLogDto,
  ) {
    return this.communicationsService.retryFailedLog(id, dto?.alternateEmail);
  }
}
