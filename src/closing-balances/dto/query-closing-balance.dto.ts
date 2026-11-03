import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../core/pagination';

export class QueryClosingBalanceDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: '2026-09',
    description: 'Reporting cycle key in YYYY-MM format',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'monthKey must be in valid YYYY-MM format (01-12)',
  })
  monthKey?: string;

  @ApiPropertyOptional({
    enum: ['ALL', 'PENDING', 'APPROVED', 'RETURNED'],
    default: 'ALL',
  })
  @IsOptional()
  @IsIn(['ALL', 'PENDING', 'APPROVED', 'RETURNED'])
  statusTab?: 'ALL' | 'PENDING' | 'APPROVED' | 'RETURNED' = 'ALL';

  @ApiPropertyOptional({
    description: 'Filter by asset category (e.g. MF, PMS, STOCKS, or All)',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description:
      'Search across Sr_No, Group Head, Family Member, Sub Category, etc.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by Group Head Name' })
  @IsOptional()
  @IsString()
  groupHeadName?: string;
}
