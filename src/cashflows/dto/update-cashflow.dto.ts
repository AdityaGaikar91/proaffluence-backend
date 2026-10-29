import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { CreateCashflowDto } from './create-cashflow.dto';

export class UpdateCashflowDto extends PartialType(CreateCashflowDto) {
  @ApiProperty({
    example: 'Client notified corrected dividend NAV allocation',
    description: 'Mandatory justification for record correction',
  })
  @IsString()
  @IsNotEmpty({ message: 'Correction reason is required' })
  correctionReason: string;
}
