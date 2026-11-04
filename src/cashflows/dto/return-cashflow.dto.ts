import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ReturnCashflowDto {
  @ApiProperty({
    example:
      'Reported balance diverges from custodian CAS statement — verify NAV date',
    description: 'Manager rejection reason returned to staff',
  })
  @IsString()
  @IsNotEmpty({ message: 'Return reason is required' })
  reason: string;
}
