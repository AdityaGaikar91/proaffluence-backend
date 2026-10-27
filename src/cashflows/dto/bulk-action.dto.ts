import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';

export class BulkActionDto {
  @ApiProperty({ example: ['cf-1', 'cf-2'], description: 'List of cashflow IDs' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];

  @ApiPropertyOptional({ example: 'Batch returned to staff for NAV date verification', description: 'Mandatory reason for batch returns' })
  @IsOptional()
  @IsString()
  reason?: string;
}
