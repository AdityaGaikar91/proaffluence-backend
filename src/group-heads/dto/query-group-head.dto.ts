import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { AssetCategory } from '@prisma/client';
import { PaginationQueryDto } from '../../core/pagination';

export class QueryGroupHeadDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Search across Name, Custom ID, Contact Person, Email, and PAN',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by asset category',
    enum: AssetCategory,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(AssetCategory)
  category?: AssetCategory;

  @ApiPropertyOptional({
    description: 'Filter by operational status',
    enum: ['Active', 'Inactive', 'All'],
    default: 'All',
  })
  @IsOptional()
  @IsIn(['Active', 'Inactive', 'All'])
  status?: 'Active' | 'Inactive' | 'All';
}
