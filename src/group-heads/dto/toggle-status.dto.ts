import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';

export class ToggleStatusDto {
  @ApiProperty({ example: 'Inactive', enum: ['Active', 'Inactive'] })
  @IsNotEmpty()
  @IsIn(['Active', 'Inactive'], {
    message: 'status must be either Active or Inactive',
  })
  status: 'Active' | 'Inactive';
}
