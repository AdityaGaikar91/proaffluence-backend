import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { AssetCategory } from '@prisma/client';

export class CreateGroupHeadDto {
  @ApiPropertyOptional({
    example: 'GH-0105',
    description: 'Mandate Custom ID (auto-generated if omitted)',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  customId?: string;

  @ApiProperty({
    example: 'Mehta Family Office',
    description: 'Legal entity or family office name',
  })
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  name: string;

  @ApiPropertyOptional({
    example: 'Harish Mehta',
    description: 'Primary contact person',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  contactPerson?: string;

  @ApiProperty({
    example: 'harish@mehtatrust.com',
    description: 'Primary PDF dispatch email',
  })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiPropertyOptional({
    example: 'accounts@mehtatrust.com',
    description: 'Secondary/accountant email',
  })
  @IsOptional()
  @IsEmail({}, { message: 'secondaryEmail must be a valid email address' })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  secondaryEmail?: string;

  @ApiProperty({
    example: '15-08-2021',
    description: 'Earliest portfolio investment date (dd-MM-yyyy)',
  })
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, {
    message: 'inceptionDate must be in dd-MM-yyyy format',
  })
  inceptionDate: string;

  @ApiProperty({
    example: 'ABCDE1234F',
    description: 'Client PAN (used as PDF encryption password)',
  })
  @IsString()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, {
    message: 'pan must be a valid 10-character PAN (e.g. ABCDE1234F)',
  })
  pan: string;

  @ApiPropertyOptional({
    example: 'Active',
    enum: ['Active', 'Inactive'],
    default: 'Active',
  })
  @IsOptional()
  @IsIn(['Active', 'Inactive'])
  status?: 'Active' | 'Inactive';

  @ApiPropertyOptional({
    example: 'Anchor HNI mandate.',
    description: 'Operational notes',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  notes?: string;

  @ApiPropertyOptional({
    example: ['MF', 'PMS'],
    enum: AssetCategory,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @Transform(({ value }: { value: unknown }): unknown => {
    if (Array.isArray(value)) {
      return value.map((v: unknown) =>
        typeof v === 'string' ? v.toUpperCase() : v,
      );
    }
    return value;
  })
  @IsEnum(AssetCategory, {
    each: true,
    message: 'Each category must be one of: MF, PMS, STOCKS',
  })
  categories?: AssetCategory[];

  @ApiPropertyOptional({
    example: ['Harish Mehta', 'Sunita Mehta'],
    description: 'Initial family members',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  familyMembers?: string[];
}
