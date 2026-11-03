import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
} from 'class-validator';

export class CampaignBatchActionDto {
  @ApiProperty({
    type: [String],
    example: ['abc', 'sharma'],
    description: 'List of GroupHead IDs to act on',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  groupHeadIds: string[];

  @ApiPropertyOptional({ example: '30-09-2026' })
  @IsOptional()
  @IsString()
  reportDate?: string;
}

export class RerouteDeliveryLogDto {
  @ApiProperty({ example: 'updated.client@example.com' })
  @IsEmail()
  alternateEmail: string;
}
