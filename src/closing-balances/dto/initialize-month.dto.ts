import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class InitializeMonthDto {
  @ApiProperty({
    example: '2026-10',
    description: 'Target reporting cycle key in YYYY-MM format',
  })
  @IsString()
  @IsNotEmpty({ message: 'monthKey is required' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'monthKey must be in YYYY-MM format (month 01-12)',
  })
  monthKey: string;
}
