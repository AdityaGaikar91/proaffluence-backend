import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VoidCashflowDto {
  @ApiProperty({ example: 'Duplicate trade entry entered in error by broker operator', description: 'Mandatory reason for voiding this trade entry' })
  @IsString()
  @IsNotEmpty({ message: 'Void reason is required' })
  reason: string;
}
