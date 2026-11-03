import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';

export class BulkBalanceActionDto {
  @ApiProperty({
    example: ['cb-1', 'cb-2'],
    description: 'List of closing balance IDs',
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'IDs array cannot be empty' })
  @IsString({ each: true })
  ids: string[];

  @ApiPropertyOptional({
    example: 'Valuation divergent from CAS statement',
    description: 'Mandatory reason for batch returns',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
