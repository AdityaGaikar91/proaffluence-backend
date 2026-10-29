import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateFamilyMemberDto {
  @ApiProperty({
    example: 'Sunita Mehta',
    description: 'Family member or beneficiary name',
  })
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  name: string;

  @ApiPropertyOptional({
    example: 'Spouse',
    description:
      'Relationship to Group Head (e.g., Karta, Self, Spouse, Trust)',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  relationship?: string;

  @ApiPropertyOptional({
    example: 'BHPPS9123M',
    description: 'Individual PAN if available',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, {
    message: 'pan must be a valid 10-character PAN',
  })
  pan?: string;
}
