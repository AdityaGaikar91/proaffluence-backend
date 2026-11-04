import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { BenchmarkCode } from '@prisma/client';
import { CreateManualIndexRecordDto } from './create-manual-index.dto';

export class BulkUploadIndexRecordsDto {
  @ApiProperty({ type: [CreateManualIndexRecordDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateManualIndexRecordDto)
  records: CreateManualIndexRecordDto[];
}

export class SyncBenchmarkFeedDto {
  @ApiPropertyOptional({
    enum: BenchmarkCode,
    example: BenchmarkCode.NIFTY_50_TRI,
  })
  @IsOptional()
  @IsEnum(BenchmarkCode)
  indexCode?: BenchmarkCode;

  @ApiPropertyOptional({
    example: '30-09-2026',
    description: 'Defaults to the last completed month-end (IST).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})$/, {
    message: 'periodDate must be dd-MM-yyyy or yyyy-MM-dd',
  })
  periodDate?: string;
}

export class BackfillBenchmarkFeedDto {
  @ApiProperty({ enum: BenchmarkCode, example: BenchmarkCode.NIFTY_50_PR })
  @IsEnum(BenchmarkCode)
  indexCode: BenchmarkCode;

  @ApiProperty({ example: '01-04-2025' })
  @IsString()
  @Matches(/^(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})$/, {
    message: 'fromDate must be dd-MM-yyyy or yyyy-MM-dd',
  })
  fromDate: string;

  @ApiProperty({ example: '31-03-2026' })
  @IsString()
  @Matches(/^(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})$/, {
    message: 'toDate must be dd-MM-yyyy or yyyy-MM-dd',
  })
  toDate: string;
}
