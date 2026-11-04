import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject } from 'class-validator';

export class UpdateClosingAmountsDto {
  @ApiProperty({
    example: {
      '0a11f752-cf99-4d5d-88e5-cab9d4868a24': 275000,
      '0a7e23e3-7f0b-49f4-a5c2-0c95a7135858': null,
    },
    description:
      'Map of closing balance IDs to new amount (or null if missing)',
  })
  @IsObject()
  @IsNotEmpty({ message: 'Updates map must not be empty' })
  updates: Record<string, number | null>;
}
