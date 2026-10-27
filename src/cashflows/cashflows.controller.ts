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
import { CashflowsService } from './cashflows.service';
import { CreateCashflowDto } from './dto/create-cashflow.dto';
import { UpdateCashflowDto } from './dto/update-cashflow.dto';
import { VoidCashflowDto } from './dto/void-cashflow.dto';
import { ReturnCashflowDto } from './dto/return-cashflow.dto';
import { BulkActionDto } from './dto/bulk-action.dto';
import { QueryCashflowDto } from './dto/query-cashflow.dto';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Master Cashflows')
@ApiCookieAuth('proaffluence.session_token')
@UseGuards(AuthGuard)
@Controller('api/v1/cashflows')
export class CashflowsController {
  constructor(private readonly cashflowsService: CashflowsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a new trade cashflow entry (Save Entry)' })
  @ApiResponse({ status: 201, description: 'Trade entry successfully queued for review.' })
  @ApiResponse({ status: 400, description: 'Invalid group head or validation failure.' })
  async create(
    @Body() dto: CreateCashflowDto,
    @CurrentUser() user: { id: string; name?: string; role?: string },
  ) {
    return this.cashflowsService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List cashflows with status tabs, search, and pagination' })
  @ApiResponse({ status: 200, description: 'Returns cashflow rows with tab counts.' })
  async findAll(@Query() query: QueryCashflowDto) {
    return this.cashflowsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single cashflow entry with complete audit trail' })
  @ApiResponse({ status: 200, description: 'Returns cashflow entry with audit log.' })
  @ApiResponse({ status: 404, description: 'Entry not found.' })
  async findOne(@Param('id') id: string) {
    return this.cashflowsService.findOne(id);
  }

  @Patch(':id/correct')
  @ApiOperation({ summary: 'Correct cashflow record with mandatory reason' })
  @ApiResponse({ status: 200, description: 'Record updated and re-queued for review.' })
  async correct(
    @Param('id') id: string,
    @Body() dto: UpdateCashflowDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.cashflowsService.correct(id, dto, user);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void a cashflow record with mandatory reason' })
  @ApiResponse({ status: 200, description: 'Record marked as voided.' })
  async void(
    @Param('id') id: string,
    @Body() dto: VoidCashflowDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.cashflowsService.void(id, dto, user);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manager approve a pending cashflow record' })
  @ApiResponse({ status: 200, description: 'Record approved.' })
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.cashflowsService.approve(id, user);
  }

  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manager return a cashflow record for correction' })
  @ApiResponse({ status: 200, description: 'Record returned with reason.' })
  async returnForCorrection(
    @Param('id') id: string,
    @Body() dto: ReturnCashflowDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.cashflowsService.returnForCorrection(id, dto, user);
  }

  @Post('bulk-approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch approve multiple pending cashflows' })
  @ApiResponse({ status: 200, description: 'Count of approved entries.' })
  async bulkApprove(
    @Body() dto: BulkActionDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.cashflowsService.bulkApprove(dto.ids, user);
  }

  @Post('bulk-return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch return multiple cashflows for correction' })
  @ApiResponse({ status: 200, description: 'Count of returned entries.' })
  async bulkReturn(
    @Body() dto: BulkActionDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('A mandatory reason is required for batch returns.');
    }
    return this.cashflowsService.bulkReturn(dto.ids, dto.reason.trim(), user);
  }
}
