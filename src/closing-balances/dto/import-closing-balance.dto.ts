import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  IsString,
  IsNotEmpty,
  Matches,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { AssetCategory } from '@prisma/client';

export class ImportClosingBalanceRowDto {
  @ApiPropertyOptional({
    example: '31-10-2026',
    description: 'Valuation date (dd-MM-yyyy); defaults to last day of monthKey',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, {
    message: 'Date_Of_Entry must be in dd-MM-yyyy format',
  })
  Date_Of_Entry?: string;

  @ApiPropertyOptional({
    example: 'ABCDE1234F',
    description: 'Client PAN / operator User_Id',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  User_Id?: string;

  @ApiPropertyOptional({
    example: '01-03-2018',
    description:
      'Valuation date of the balance (dd-MM-yyyy). When present it sets the reporting cycle (monthKey) of the row.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, {
    message: 'Closing_Balance_date must be in dd-MM-yyyy format',
  })
  Closing_Balance_date?: string;

  @ApiPropertyOptional({
    example: 'Mar-18',
    description:
      'Reporting month label (e.g. "Mar-18", "March 2018", "2018-03"). Sets the cycle of the row when Closing_Balance_date is absent.',
  })
  @IsOptional()
  @IsString()
  Month?: string;

  @ApiProperty({
    example: 'Desai Group',
    description: 'Registered Group Head Name',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  Group_Head_Name: string;

  @ApiProperty({
    example: 'Desai Enterprises Ltd',
    description: 'Family Member Beneficiary',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  Family_Member_Name: string;

  @ApiProperty({
    example: 'MF',
    enum: ['MF', 'PMS', 'STOCKS', 'EQUITY', 'DEBT', 'OTHER'],
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
    description: 'Sub-category classification',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  Sub_Category: string;

  @ApiPropertyOptional({
    example: 250000,
    description: 'Closing market value in INR (null/omit if unvalued)',
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown => {
    if (value === null || value === undefined || value === '') return null;
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
}

export class ImportClosingBalanceRowsDto {
  @ApiProperty({
    example: '2026-11',
    description:
      'Fallback reporting cycle (YYYY-MM) for rows without Closing_Balance_date or Month',
  })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'monthKey must be in YYYY-MM format (month 01-12)',
  })
  monthKey: string;

  @ApiProperty({
    type: [ImportClosingBalanceRowDto],
    description: 'Validated closing balance rows to import',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ImportClosingBalanceRowDto)
  rows: ImportClosingBalanceRowDto[];
}
