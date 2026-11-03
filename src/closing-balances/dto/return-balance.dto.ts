import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class ReturnBalanceDto {
  @ApiProperty({
    example: 'Reported valuation diverges from custodian statement',
    description: 'Manager rejection reason returned to staff',
  })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Return reason is required and cannot be empty' })
  reason: string;
}
