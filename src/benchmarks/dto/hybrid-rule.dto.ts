import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateHybridRuleDto {
  @ApiProperty({ example: 'ICICI Prudential Balanced Advantage Fund' })
  @IsString()
  @IsNotEmpty()
  schemeName: string;

  @ApiPropertyOptional({ example: 'MF', default: 'MF' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ example: 65, minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  equityRatio: number;

  @ApiPropertyOptional({ example: 'Dynamic asset allocation override' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateHybridRuleDto {
  @ApiProperty({ example: 60, minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  equityRatio: number;

  @ApiPropertyOptional({ example: 'Updated allocation ratio' })
  @IsOptional()
  @IsString()
  notes?: string;
}
