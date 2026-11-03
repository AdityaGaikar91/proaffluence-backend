import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BenchmarksService } from './benchmarks.service';
import { CreateManualIndexRecordDto } from './dto/create-manual-index.dto';
import {
  BulkUploadIndexRecordsDto,
  BackfillBenchmarkFeedDto,
  SyncBenchmarkFeedDto,
} from './dto/bulk-upload-index.dto';
import {
  CreateHybridRuleDto,
  UpdateHybridRuleDto,
} from './dto/hybrid-rule.dto';

@ApiTags('Benchmarks & Hybrid Allocation Rules')
@ApiCookieAuth('proaffluence.session_token')
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1/benchmarks')
export class BenchmarksController {
  constructor(private readonly benchmarksService: BenchmarksService) {}

  @Get('indices')
  @ApiOperation({
    summary:
      'Get benchmark metadata, feed health, historical IndicesData records, and FY returns',
  })
  getIndicesOverview() {
    return this.benchmarksService.getIndicesOverview();
  }

  @Post('indices/manual')
  @ApiOperation({
    summary: 'Add manual index closing quote fallback to IndicesData',
  })
  addManualRecord(
    @Body() dto: CreateManualIndexRecordDto,
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.benchmarksService.addManualRecord(
      dto,
      user?.name || 'Operations Specialist',
    );
  }

  @Post('indices/bulk')
  @ApiOperation({
    summary: 'Bulk ingest CSV/TSV index closing quotes into IndicesData',
  })
  bulkUploadRecords(
    @Body() dto: BulkUploadIndexRecordsDto,
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.benchmarksService.bulkUploadRecords(
      dto,
      user?.name || 'Operations Specialist (Bulk)',
    );
  }

  @Delete('indices/:id')
  @ApiOperation({ summary: 'Delete an IndicesData record' })
  deleteIndexRecord(@Param('id') id: string) {
    return this.benchmarksService.deleteIndexRecord(id);
  }

  @Post('indices/sync')
  @ApiOperation({
    summary: 'Trigger free public benchmark feed synchronization',
  })
  syncFeed(
    @Body() dto: SyncBenchmarkFeedDto,
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.benchmarksService.syncFeed(
      dto,
      user?.name || 'Automated Feed Worker',
    );
  }

  @Post('indices/backfill')
  @Roles('manager', 'super_admin')
  @ApiOperation({
    summary:
      'Backfill daily index levels from free feeds for a date range (cashflow-date alignment)',
  })
  backfillFeed(
    @Body() dto: BackfillBenchmarkFeedDto,
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.benchmarksService.backfillFeed(
      dto,
      user?.name || 'Automated Feed Worker',
    );
  }

  @Get('hybrid-rules')
  @ApiOperation({
    summary:
      'List all Hybrid 50/50 asset allocation rules and custom overrides',
  })
  listHybridRules() {
    return this.benchmarksService.listHybridRules();
  }

  @Post('hybrid-rules')
  @Roles('manager', 'super_admin')
  @ApiOperation({
    summary:
      'Create a custom scheme-level Hybrid Equity/Debt allocation override',
  })
  createHybridRule(
    @Body() dto: CreateHybridRuleDto,
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.benchmarksService.createHybridRule(
      dto,
      user?.name || 'Manager',
    );
  }

  @Patch('hybrid-rules/:id')
  @Roles('manager', 'super_admin')
  @ApiOperation({
    summary: 'Update a Hybrid Equity/Debt allocation override ratio',
  })
  updateHybridRule(
    @Param('id') id: string,
    @Body() dto: UpdateHybridRuleDto,
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.benchmarksService.updateHybridRule(
      id,
      dto,
      user?.name || 'Manager',
    );
  }

  @Post('hybrid-rules/reset-all')
  @Roles('manager', 'super_admin')
  @ApiOperation({
    summary: 'Reset all Hybrid scheme overrides to the standard 50/50 split',
  })
  resetAllHybridRules(@CurrentUser() user: { id: string; name: string }) {
    return this.benchmarksService.resetAllHybridRules(user?.name || 'Manager');
  }

  @Delete('hybrid-rules/:id')
  @Roles('manager', 'super_admin')
  @ApiOperation({ summary: 'Delete a custom Hybrid allocation override rule' })
  deleteHybridRule(@Param('id') id: string) {
    return this.benchmarksService.deleteHybridRule(id);
  }
}
