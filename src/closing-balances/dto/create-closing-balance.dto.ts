import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { AssetCategory } from '@prisma/client';

export class CreateClosingBalanceDto {
  @ApiPropertyOptional({
    example: 93,
    description: 'Sequence reference number (auto-assigned if omitted)',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  Sr_No?: number;

  @ApiProperty({
    example: '31-10-2026',
    description: 'Entry valuation date in dd-MM-yyyy format',
  })
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, {
    message: 'Date_Of_Entry must be in dd-MM-yyyy format',
  })
  Date_Of_Entry: string;

  @ApiPropertyOptional({
    example: 'USR-001',
    description: 'Operator or client PAN identifier',
  })
  @IsOptional()
  @IsString()
  User_Id?: string;

  @ApiPropertyOptional({
    example: 'October 2026',
    description: 'Reporting month label',
  })
  @IsOptional()
  @IsString()
  Month?: string;

  @ApiPropertyOptional({
    example: '2026-10',
    description:
      'Reporting cycle key in YYYY-MM format (auto-derived if omitted)',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'monthKey must be in YYYY-MM format (month 01-12)',
  })
  monthKey?: string;

  @ApiProperty({
    example: 'Desai Group',
    description: 'Registered Group Head Name',
  })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Group_Head_Name is required' })
  Group_Head_Name: string;

  @ApiProperty({
    example: 'Desai Enterprises Ltd',
    description: 'Family Member Beneficiary',
  })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Family_Member_Name is required' })
  Family_Member_Name: string;

  @ApiProperty({
    example: 'MF',
    enum: ['MF', 'PMS', 'Stocks', 'STOCK', 'Equity', 'Debt', 'Other'],
  })
  @Transform(({ value }: { value: unknown }): unknown => {
    if (typeof value !== 'string') return value;
    const upper = value.trim().toUpperCase();
    if (upper === 'STOCK') return 'STOCKS';
    return upper;
  })
  @IsEnum(AssetCategory, {
    message: 'Category must be one of: MF, PMS, STOCKS, EQUITY, DEBT, OTHER',
  })
  Category: AssetCategory;

  @ApiProperty({
    example: 'EQUITY',
    description: 'Sub-category classification (EQUITY, DEBT, HYBRID)',
  })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Sub_Category is required' })
  Sub_Category: string;

  @ApiPropertyOptional({
    example: 250000,
    description: 'Closing market value in INR (or null if unvalued/missing)',
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown => {
    if (value === null || value === undefined || value === '') return value;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return value;
    return Math.round(n * 100) / 100;
  })
  @IsNumber({}, { message: 'Closing_Amount must be a number' })
  @Min(0, { message: 'Closing_Amount cannot be negative' })
  @Max(999999999999999, {
    message: 'Closing_Amount exceeds maximum allowed limit',
  })
  Closing_Amount?: number | null;

  @ApiPropertyOptional({
    example: false,
    description:
      'When true (managers/imports), allow Date_Of_Entry outside the monthKey calendar month for historical backfills',
  })
  @IsOptional()
  @IsBoolean()
  allowBackdatedEntry?: boolean;
}
