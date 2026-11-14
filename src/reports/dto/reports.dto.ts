import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Minimum length of a manager's justification for overriding a pre-flight gate. */
export const OVERRIDE_REASON_MIN_LENGTH = 10;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

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

  @ApiPropertyOptional({
    example: false,
    description:
      'Manager/Admin only: freeze even though pre-flight blockers remain. Requires overrideReason; logged in the audit trail with the blockers.',
  })
  @IsOptional()
  @IsBoolean()
  forceOverride?: boolean;

  @ApiPropertyOptional({
    example:
      'Client confirmed PMS valuation by phone; statement arrives after dispatch deadline.',
    description: `Required when forceOverride=true (min ${OVERRIDE_REASON_MIN_LENGTH} characters after trimming).`,
  })
  @Transform(trimString)
  @ValidateIf((o: { forceOverride?: boolean }) => o.forceOverride === true)
  @IsString()
  @IsNotEmpty({
    message: 'overrideReason is required when forceOverride is true.',
  })
  @MinLength(OVERRIDE_REASON_MIN_LENGTH, {
    message: `overrideReason must be at least ${OVERRIDE_REASON_MIN_LENGTH} characters.`,
  })
  @MaxLength(1000)
  overrideReason?: string;
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

  @ApiPropertyOptional({
    example: false,
    description:
      'Manager/Admin only: run even though closing balances are missing (FR-3.3). Not needed when the period was frozen with an override. Requires overrideReason.',
  })
  @IsOptional()
  @IsBoolean()
  forceOverride?: boolean;

  @ApiPropertyOptional({
    description: `Required when forceOverride=true (min ${OVERRIDE_REASON_MIN_LENGTH} characters after trimming).`,
  })
  @Transform(trimString)
  @ValidateIf((o: { forceOverride?: boolean }) => o.forceOverride === true)
  @IsString()
  @IsNotEmpty({
    message: 'overrideReason is required when forceOverride is true.',
  })
  @MinLength(OVERRIDE_REASON_MIN_LENGTH, {
    message: `overrideReason must be at least ${OVERRIDE_REASON_MIN_LENGTH} characters.`,
  })
  @MaxLength(1000)
  overrideReason?: string;
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
