import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../core/pagination';

export class QueryCashflowDto extends PaginationQueryDto {
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
}
