import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class ApproveMonthDto {
  @ApiProperty({
    example: '2026-09',
    description: 'Reporting cycle key in YYYY-MM format to approve',
  })
  @IsString()
  @IsNotEmpty({ message: 'monthKey is required' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'monthKey must be in YYYY-MM format (month 01-12)',
  })
  monthKey: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'Manager override flag to approve cycle even if some balances remain missing',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allowMissingOverride?: boolean = false;

  @ApiPropertyOptional({
    example:
      'Client portfolio account in transition; approved with missing PMS valuation',
    description: 'Mandatory justification if approving with missing valuations',
  })
  @IsOptional()
  @IsString()
  overrideReason?: string;
}
