import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { TransactionType, AssetCategory } from '@prisma/client';

export class CreateCashflowDto {
  @ApiPropertyOptional({ example: 46, description: 'Row sequence number (auto-assigned if omitted)' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  Sr_No?: number;

  @ApiProperty({ example: '26-10-2026', description: 'System date of entry (dd-MM-yyyy)' })
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, { message: 'Date_Of_Entry must be in dd-MM-yyyy format' })
  Date_Of_Entry: string;

  @ApiPropertyOptional({ example: 'USR-001', description: 'Operator identifier' })
  @IsOptional()
  @IsString()
  User_Id?: string;

  @ApiPropertyOptional({ example: 'October 2026', description: 'Reporting month label' })
  @IsOptional()
  @IsString()
  Month?: string;

  @ApiProperty({ example: 'ABC Family Office', description: 'Registered Group Head Name' })
  @IsString()
  @IsNotEmpty()
  Group_Head_Name: string;

  @ApiProperty({ example: 'Rajesh ABC', description: 'Family Member Beneficiary' })
  @IsString()
  @IsNotEmpty()
  Family_Member_Name: string;

  @ApiProperty({ example: 'Anil K.', description: 'Client Relationship Manager / Owner' })
  @IsString()
  @IsNotEmpty()
  Client_Owner: string;

  @ApiProperty({ example: '26-10-2026', description: 'Trade date (dd-MM-yyyy)' })
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, { message: 'Transaction_Date must be in dd-MM-yyyy format' })
  Transaction_Date: string;

  @ApiProperty({ example: 'Purchase', enum: ['Purchase', 'Redemption', 'PURCHASE', 'REDEMPTION'] })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsEnum(TransactionType, { message: 'Transaction_Type must be Purchase or Redemption' })
  Transaction_Type: TransactionType;

  @ApiProperty({ example: 'MF', enum: ['MF', 'PMS', 'Stocks', 'Equity', 'Debt', 'Other'] })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsEnum(AssetCategory, { message: 'Category must be one of: MF, PMS, Stocks, Equity, Debt, Other' })
  Category: AssetCategory;

  @ApiProperty({ example: 'Nippon India Multi Cap Fund - Growth', description: 'Scheme or strategy' })
  @IsString()
  @IsNotEmpty()
  Sub_Category: string;

  @ApiProperty({ example: 150000, description: 'Gross transaction amount in INR' })
  @IsNumber()
  Amounts: number;

  @ApiPropertyOptional({ example: 150000, description: 'Fresh capital inflow in INR', default: 0 })
  @IsOptional()
  @IsNumber()
  New_Investments?: number;

  @ApiPropertyOptional({ example: 0, description: 'Realized profit or loss in INR', default: 0 })
  @IsOptional()
  @IsNumber()
  Profit_Loss?: number;

  @ApiPropertyOptional({ example: 12.5, description: 'Historical XIRR percentage', default: 0 })
  @IsOptional()
  @IsNumber()
  XIRR?: number;
}
