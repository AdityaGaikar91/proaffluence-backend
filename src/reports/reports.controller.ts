import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import {
  ExecuteCalculationRunDto,
  FreezeReportingRunDto,
  GeneratePdfBatchDto,
  QueryAnnualDashboardDto,
  UnfreezeReportingRunDto,
  UploadExternalPdfDto,
} from './dto/reports.dto';

@ApiTags('Reports, O_Template Calculation & PDF Engine')
@ApiCookieAuth('proaffluence.session_token')
@UseGuards(AuthGuard, RolesGuard)
@Controller('api/v1/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('pre-flight')
  @ApiOperation({
    summary:
      'Evaluate month-end pre-flight audit gates (missing balances, pending approvals, missing emails, benchmark sync) and freeze status',
  })
  getPreFlightAudit(
    @Query('period') period?: string,
    @Query('monthKey') monthKey?: string,
    @Query('groupHeadId') groupHeadId?: string,
  ) {
    return this.reportsService.getPreFlightAudit(period, monthKey, groupHeadId);
  }

  @Post('freeze')
  @Roles('manager', 'super_admin')
  @ApiOperation({
    summary: 'Seal and freeze a month-end reporting run (Manager/Admin only)',
  })
  freezeReportingRun(
    @Body() dto: FreezeReportingRunDto,
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.reportsService.freezeReportingRun(dto, {
      id: user.id,
      name: user.name || 'Operations Manager',
    });
  }

  @Post('unfreeze')
  @Roles('manager', 'super_admin')
  @ApiOperation({
    summary:
      'Unfreeze a sealed reporting run with mandatory audit reason (Manager/Admin only)',
  })
  unfreezeReportingRun(
    @Body() dto: UnfreezeReportingRunDto,
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.reportsService.unfreezeReportingRun(dto, {
      id: user.id,
      name: user.name || 'Operations Manager',
    });
  }

  @Post('calculate')
  @Roles('manager', 'super_admin')
  @ApiOperation({
    summary:
      'Execute the 5-stage Hybrid O_Template Calculation Pipeline (XIRR vs P2P, 50/50 Hybrid split, DashData & O_Template.xlsx population)',
  })
  executeCalculationRun(
    @Body() dto: ExecuteCalculationRunDto,
    @CurrentUser() user: { id: string; name: string },
  ) {
    return this.reportsService.executeCalculationRun(dto, {
      id: user.id,
      name: user.name || 'Operations Manager',
    });
  }

  @Get('annual-dashboard')
  @ApiOperation({
    summary:
      'Get calculated FY Annual Dashboard payload (Page 1: SUMMARY, XIRR by Category, Asset Allocation Movement)',
  })
  getAnnualDashboard(@Query() query: QueryAnnualDashboardDto) {
    return this.reportsService.getAnnualDashboard(query);
  }

  @Get('consolidated')
  @ApiOperation({
    summary:
      'Get Consolidated Report payload (Page 1 FY Dashboard + uploaded external PDFs metadata & merged PDF URLs)',
  })
  getConsolidatedReport(@Query() query: QueryAnnualDashboardDto) {
    return this.reportsService.getConsolidatedReport(query);
  }

  @Get('external-pdfs/:groupHeadId')
  @ApiOperation({
    summary:
      'List external PDFs (MF Summary, PMS Summary, Stock Summary, Stallion Statement) uploaded for a Group Head to merge with Page 1',
  })
  listExternalPdfs(
    @Param('groupHeadId') groupHeadId: string,
    @Query('period') period?: string,
  ) {
    return this.reportsService.listExternalPdfs(
      groupHeadId,
      period || '30-09-2026',
    );
  }

  @Post('external-pdfs/:groupHeadId')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary:
      'Upload an external PDF (MF Summary, PMS Summary, Stock Summary, Stallion Statement) via multipart/form-data or base64 to merge after Page 1',
  })
  uploadExternalPdf(
    @Param('groupHeadId') groupHeadId: string,
    @Body() dto: UploadExternalPdfDto,
    @UploadedFile() file: { originalname?: string; buffer?: Buffer } | undefined,
    @CurrentUser() user: { id: string; name: string },
  ) {
    let buffer: Buffer | null = null;
    let filename = dto.filename || `${dto.slot}.pdf`;

    if (file && file.buffer) {
      buffer = file.buffer;
      filename = file.originalname || filename;
    } else if (dto.base64Content) {
      const cleaned = dto.base64Content.replace(
        /^data:application\/pdf;base64,/,
        '',
      );
      buffer = Buffer.from(cleaned, 'base64');
    }

    if (!buffer || buffer.length === 0) {
      throw new BadRequestException(
        'Please provide a PDF file via multipart "file" field or "base64Content" JSON property.',
      );
    }

    return this.reportsService.uploadExternalPdf({
      groupHeadId,
      period: dto.period || '30-09-2026',
      slot: dto.slot,
      originalFilename: filename,
      buffer,
      uploadedBy: user?.name || 'Operations Staff',
    });
  }

  @Get('external-pdfs/:groupHeadId/:attachmentId/file')
  @ApiOperation({
    summary:
      'Stream a single uploaded external PDF for inline preview (authenticated)',
  })
  streamExternalPdfFile(
    @Param('groupHeadId') groupHeadId: string,
    @Param('attachmentId') attachmentId: string,
    @Query('period') period: string | undefined,
    @Res() res: Response,
  ) {
    const result = this.reportsService.getExternalPdfFile({
      groupHeadId,
      attachmentId,
      period: period || '30-09-2026',
    });

    const safeName = (result.attachment.originalFilename || 'external.pdf')
      .replace(/[^\w.\-]+/g, '_')
      .slice(0, 120);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${safeName}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-External-PDF-Slot', result.attachment.slot);
    res.setHeader(
      'X-External-PDF-Pages',
      String(result.attachment.pageCount),
    );
    res.send(result.buffer);
  }

  @Delete('external-pdfs/:groupHeadId/:attachmentId')
  @ApiOperation({
    summary: 'Delete an uploaded external PDF attachment for a Group Head',
  })
  deleteExternalPdf(
    @Param('groupHeadId') groupHeadId: string,
    @Param('attachmentId') attachmentId: string,
    @Query('period') period?: string,
  ) {
    return this.reportsService.deleteExternalPdf({
      groupHeadId,
      attachmentId,
      period: period || '30-09-2026',
    });
  }

  @Post('pdf')
  @ApiOperation({
    summary:
      'Generate batch or single password-protected Consolidated PDFs (Page 1 FY Annual Dashboard + merged external PDFs)',
  })
  generateBatchPdfs(@Body() dto: GeneratePdfBatchDto) {
    return this.reportsService.generateBatchPdfs(dto);
  }

  @Get('pdf/:groupHeadId')
  @ApiOperation({
    summary:
      'Download or preview the merged Consolidated PDF (Page 1 FY Annual Dashboard + external PDFs) for a Group Head (supports ?encrypted=true|false)',
  })
  async streamClientPdf(
    @Param('groupHeadId') groupHeadId: string,
    @Query('period') period: string | undefined,
    @Query('encrypted') encrypted: string | undefined,
    @Res() res: Response,
  ) {
    const isEncrypted = encrypted !== 'false';
    const result = await this.reportsService.generateClientPdf({
      groupHeadId,
      period,
      encrypted: isEncrypted,
    });

    const safeName = (result.groupHeadName || groupHeadId).replace(
      /\s+/g,
      '_',
    );
    const filename = `FY_Annual_Dashboard_${safeName}_${period || '30-09-2026'}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${isEncrypted ? 'attachment' : 'inline'}; filename="${filename}"`,
    );
    res.setHeader('X-PDF-Engine', result.engine);
    res.setHeader(
      'X-PDF-Password-Protected',
      String(result.isPasswordProtected),
    );
    res.setHeader('X-PDF-Total-Pages', String(result.totalMergedPages));
    res.setHeader('X-PDF-External-Count', String(result.externalPdfsCount));
    res.send(result.buffer);
  }

  @Get('template/:groupHeadId')
  @ApiOperation({
    summary:
      'Download the populated O_Template.xlsx workbook for a specific Group Head',
  })
  async downloadPopulatedTemplate(
    @Param('groupHeadId') groupHeadId: string,
    @Query('period') period: string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.reportsService.generateWorkbookForClient(
      groupHeadId,
      period || '30-09-2026',
    );

    const safeName = (result.groupHead?.name || groupHeadId).replace(
      /\s+/g,
      '_',
    );
    const filename = `O_Template_${safeName}_${period || '30-09-2026'}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(result.buffer);
  }
}
