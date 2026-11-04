import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { ClosingBalancesService } from './closing-balances.service';
import { QueryClosingBalanceDto } from './dto/query-closing-balance.dto';
import { UpdateClosingAmountsDto } from './dto/update-closing-amounts.dto';
import { InitializeMonthDto } from './dto/initialize-month.dto';
import { CreateClosingBalanceDto } from './dto/create-closing-balance.dto';
import { ReturnBalanceDto } from './dto/return-balance.dto';
import { BulkBalanceActionDto } from './dto/bulk-balance-action.dto';
import { ApproveMonthDto } from './dto/approve-month.dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Monthly Closing Balances')
@ApiCookieAuth('proaffluence.session_token')
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1/closing-balances')
export class ClosingBalancesController {
  constructor(
    private readonly closingBalancesService: ClosingBalancesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List closing balances with status tabs, search, and pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns closing balance rows with tab & missing counts.',
  })
  async findAll(@Query() query: QueryClosingBalanceDto) {
    return this.closingBalancesService.findAll(query);
  }

  @Get('summary')
  @ApiOperation({
    summary:
      'Get cycle statistics (total, missing, pending, approved, AUM) for a given monthKey',
  })
  @ApiResponse({ status: 200, description: 'Summary statistics payload.' })
  async getSummary(@Query('monthKey') monthKey: string) {
    return this.closingBalancesService.getSummary(monthKey);
  }

  @Post('initialize-month')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Option B: On-demand scaffold missing grid rows for active mandates in a given monthKey',
  })
  @ApiResponse({ status: 200, description: 'Count of newly scaffolded rows.' })
  async initializeMonth(
    @Body() dto: InitializeMonthDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.closingBalancesService.initializeMonth(dto, user);
  }

  @Patch('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Option A: Batch inline cell update of closing amounts from spreadsheet matrix',
  })
  @ApiResponse({
    status: 200,
    description: 'Count of updated valuation amounts.',
  })
  async updateBatch(
    @Body() dto: UpdateClosingAmountsDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.closingBalancesService.updateBatch(dto, user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a single manual closing balance entry' })
  @ApiResponse({ status: 201, description: 'Closing balance entry created.' })
  async create(
    @Body() dto: CreateClosingBalanceDto,
    @CurrentUser() user: { id: string; name?: string; role?: string },
  ) {
    return this.closingBalancesService.create(dto, user);
  }

  @Post('approve-month')
  @Roles('manager', 'super_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'One-click manager approval for entire cycle with missing valuation gate check',
  })
  @ApiResponse({
    status: 200,
    description: 'Count of approved rows for cycle.',
  })
  async approveMonth(
    @Body() dto: ApproveMonthDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.closingBalancesService.approveMonth(dto, user);
  }

  @Post('bulk-approve')
  @Roles('manager', 'super_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch approve multiple closing balances' })
  @ApiResponse({ status: 200, description: 'Count of approved entries.' })
  async bulkApprove(
    @Body() dto: BulkBalanceActionDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.closingBalancesService.bulkApprove(dto.ids, user);
  }

  @Post('bulk-return')
  @Roles('manager', 'super_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch return multiple closing balances for correction',
  })
  @ApiResponse({ status: 200, description: 'Count of returned entries.' })
  async bulkReturn(
    @Body() dto: BulkBalanceActionDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException(
        'A mandatory reason is required for batch returns.',
      );
    }
    return this.closingBalancesService.bulkReturn(
      dto.ids,
      dto.reason.trim(),
      user,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get single closing balance entry with audit trail',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns balance record with audits.',
  })
  @ApiResponse({ status: 404, description: 'Entry not found.' })
  async findOne(@Param('id') id: string) {
    return this.closingBalancesService.findOne(id);
  }

  @Post(':id/approve')
  @Roles('manager', 'super_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manager approve a pending closing balance record' })
  @ApiResponse({ status: 200, description: 'Record approved.' })
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.closingBalancesService.approve(id, user);
  }

  @Post(':id/return')
  @Roles('manager', 'super_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manager return a closing balance record for correction',
  })
  @ApiResponse({ status: 200, description: 'Record returned with reason.' })
  async returnForCorrection(
    @Param('id') id: string,
    @Body() dto: ReturnBalanceDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.closingBalancesService.returnForCorrection(id, dto, user);
  }
}
