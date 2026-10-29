import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryCashflowDto {
  @ApiPropertyOptional({
    enum: ['ALL', 'PENDING', 'APPROVED', 'RETURNED'],
    default: 'ALL',
  })
  @IsOptional()
  @IsIn(['ALL', 'PENDING', 'APPROVED', 'RETURNED'])
  statusTab?: 'ALL' | 'PENDING' | 'APPROVED' | 'RETURNED' = 'ALL';

  @ApiPropertyOptional({
    description:
      'Search across Sr_No, Group Head, Client Owner, Sub Category, etc.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by specific reporting month (e.g. October 2026)',
  })
  @IsOptional()
  @IsString()
  month?: string;

  @ApiPropertyOptional({ description: 'Filter by Group Head Name' })
  @IsOptional()
  @IsString()
  groupHeadName?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}
