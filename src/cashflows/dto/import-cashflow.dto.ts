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
  IsInt,
  IsPositive,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { TransactionType, AssetCategory } from '@prisma/client';

export class ImportCashflowRowDto {
  @ApiPropertyOptional({
    example: 46,
    description: 'Row sequence number (auto-assigned sequentially if omitted)',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  Sr_No?: number;

  @ApiPropertyOptional({
    example: '26-10-2026',
    description: 'System date of entry (dd-MM-yyyy)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, {
    message: 'Date_Of_Entry must be in dd-MM-yyyy format',
  })
  Date_Of_Entry?: string;

  @ApiPropertyOptional({
    example: 'ABCDE1234F',
    description: 'Client PAN / Tax ID',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  User_Id?: string;

  @ApiPropertyOptional({
    example: 'October 2026',
    description: 'Reporting month label',
  })
  @IsOptional()
  @IsString()
  Month?: string;

  @ApiProperty({
    example: 'ABC Family Office',
    description: 'Registered Group Head Name',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  Group_Head_Name: string;

  @ApiProperty({
    example: 'Rajesh ABC',
    description: 'Family Member Beneficiary',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  Family_Member_Name: string;

  @ApiPropertyOptional({
    example: 'Anil K.',
    description: 'Client Relationship Manager / Owner',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  Client_Owner?: string;

  @ApiProperty({
    example: '26-10-2026',
    description: 'Trade date (dd-MM-yyyy)',
  })
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, {
    message: 'Transaction_Date must be in dd-MM-yyyy format',
  })
  Transaction_Date: string;

  @ApiProperty({
    example: 'Purchase',
    enum: ['Purchase', 'Redemption', 'PURCHASE', 'REDEMPTION'],
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : '',
  )
  @IsEnum(TransactionType, {
    message: 'Transaction_Type must be Purchase or Redemption',
  })
  Transaction_Type: TransactionType;

  @ApiProperty({
    example: 'MF',
    enum: ['MF', 'PMS', 'Stocks', 'STOCK', 'Equity', 'Debt', 'Other'],
  })
  @Transform(({ value }) => {
    if (typeof value !== 'string') return '';
    const upper = value.trim().toUpperCase();
    if (upper === 'STOCK') return 'STOCKS';
    return upper;
  })
  @IsEnum(AssetCategory, {
    message: 'Category must be one of: MF, PMS, STOCKS, EQUITY, DEBT, OTHER',
  })
  Category: AssetCategory;

  @ApiProperty({
    example: 'Nippon India Multi Cap Fund - Growth',
    description: 'Scheme or strategy',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  Sub_Category: string;

  @ApiProperty({
    example: 150000,
    description: 'Gross transaction amount in INR',
  })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const sanitized = value.replace(/,/g, '').trim();
      const n = Number(sanitized);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : value;
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return value;
    return Math.round(n * 100) / 100;
  })
  @IsNumber()
  Amounts: number;

  @ApiPropertyOptional({
    example: 150000,
    description: 'Fresh capital inflow in INR',
    default: 0,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'string') {
      const sanitized = value.replace(/,/g, '').trim();
      const n = Number(sanitized);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : value;
    }
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : value;
  })
  @IsNumber()
  New_Investments?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Realized profit or loss in INR',
    default: 0,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'string') {
      const sanitized = value.replace(/,/g, '').trim();
      const n = Number(sanitized);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : value;
    }
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : value;
  })
  @IsNumber()
  Profit_Loss?: number;

  @ApiPropertyOptional({
    example: 12.5,
    description: 'Historical XIRR percentage',
    default: 0,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'string') {
      const sanitized = value.replace(/,/g, '').trim();
      const n = Number(sanitized);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : value;
    }
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : value;
  })
  @IsNumber()
  XIRR?: number;
}

export class ImportCashflowRowsDto {
  @ApiProperty({
    type: [ImportCashflowRowDto],
    description: 'List of cashflow rows to batch import',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one cashflow row is required for import.' })
  @ArrayMaxSize(2000, {
    message: 'Batch import cannot exceed 2,000 rows per request.',
  })
  @ValidateNested({ each: true })
  @Type(() => ImportCashflowRowDto)
  rows: ImportCashflowRowDto[];
}
