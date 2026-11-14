import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** GET /closing-balances/months filters (all optional; no filter = every cycle). */
export class QueryMonthRangeDto {
  @ApiPropertyOptional({
    example: true,
    description:
      'Only count cycles with APPROVED, non-voided rows that hold a closing amount.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean({ message: 'approvedOnly must be true or false' })
  approvedOnly?: boolean;

  @ApiPropertyOptional({
    example: '23eb596e-f4f9-4e7a-b914-42c37d232a9a',
    description:
      'Restrict to one Group Head (id). "All" or empty = every Group Head.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  groupHeadId?: string;
}
