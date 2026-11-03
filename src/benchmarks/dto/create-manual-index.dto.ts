import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
} from 'class-validator';
import { BenchmarkCode } from '@prisma/client';

export class CreateManualIndexRecordDto {
  @ApiProperty({
    example: '30-09-2026',
    description: 'Date in DD-MM-YYYY or YYYY-MM-DD format',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})$/, {
    message: 'date must be in DD-MM-YYYY or YYYY-MM-DD format',
  })
  date: string;

  @ApiProperty({ enum: BenchmarkCode, example: BenchmarkCode.NIFTY_50_TRI })
  @IsEnum(BenchmarkCode)
  indexCode: BenchmarkCode;

  @ApiProperty({
    example: 34892.4,
    description: 'Positive index closing value',
  })
  @IsNumber()
  @IsPositive()
  closingValue: number;

  @ApiPropertyOptional({ example: 'Manual fallback entered by operator' })
  @IsOptional()
  @IsString()
  notes?: string;
}
