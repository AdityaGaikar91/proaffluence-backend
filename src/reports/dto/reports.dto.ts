import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export const EXTERNAL_PDF_SLOTS = [
  'MF_SUMMARY',
  'PMS_SUMMARY',
  'STOCK_SUMMARY',
  'STALLION_STATEMENT',
] as const;

export type ExternalPdfSlot = (typeof EXTERNAL_PDF_SLOTS)[number];

export class QueryAnnualDashboardDto {
  @ApiPropertyOptional({ example: 'abc' })
  @IsOptional()
  @IsString()
  groupHeadId?: string;

  @ApiPropertyOptional({ example: 'All' })
  @IsOptional()
  @IsString()
  familyMember?: string;

  @ApiPropertyOptional({ example: 'All' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: '05-07-2021' })
  @IsOptional()
  @IsString()
  fromPeriod?: string;

  @ApiPropertyOptional({ example: '30-09-2026' })
  @IsOptional()
  @IsString()
  toPeriod?: string;
}

export class FreezeReportingRunDto {
  @ApiProperty({ example: '30-09-2026' })
  @IsString()
  @IsNotEmpty()
  period: string;

  @ApiPropertyOptional({ example: '2026-09' })
  @IsOptional()
  @IsString()
  monthKey?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  forceOverride?: boolean;
}

export class UnfreezeReportingRunDto {
  @ApiProperty({ example: '30-09-2026' })
  @IsString()
  @IsNotEmpty()
  period: string;

  @ApiProperty({
    example:
      'Client notified late dividend cashflow receipt in PMS portfolio; re-verifying valuation.',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ExecuteCalculationRunDto {
  @ApiPropertyOptional({ example: '30-09-2026' })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({ example: '2026-09' })
  @IsOptional()
  @IsString()
  monthKey?: string;

  @ApiPropertyOptional({ example: 'abc' })
  @IsOptional()
  @IsString()
  groupHeadId?: string;
}

export class GeneratePdfBatchDto {
  @ApiPropertyOptional({ example: '30-09-2026' })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Optional list of groupHeadIds; if omitted generates for all active group heads',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groupHeadIds?: string[];

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  encrypted?: boolean;
}

export class UploadExternalPdfDto {
  @ApiProperty({
    enum: EXTERNAL_PDF_SLOTS,
    example: 'MF_SUMMARY',
    description:
      'External PDF slot: MF_SUMMARY | PMS_SUMMARY | STOCK_SUMMARY | STALLION_STATEMENT',
  })
  @IsString()
  @IsIn(EXTERNAL_PDF_SLOTS)
  slot: ExternalPdfSlot;

  @ApiPropertyOptional({ example: '30-09-2026', default: '30-09-2026' })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({ example: 'MF_Summary_ABC_Sep2026.pdf' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({
    description: 'Base64-encoded PDF content when not uploading via multipart/form-data',
  })
  @IsOptional()
  @IsString()
  base64Content?: string;
}
