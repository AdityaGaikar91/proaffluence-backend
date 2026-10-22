import { ApiProperty } from '@nestjs/swagger';

export class MeResponseDto {
  @ApiProperty({ description: 'User unique identifier', example: 'cm3abc1230000xyz' })
  id: string;

  @ApiProperty({ description: 'User corporate email address', example: 'admin@proaffluence.com' })
  email: string;

  @ApiProperty({ description: 'User full display name', example: 'Super Admin One' })
  name: string;

  @ApiProperty({
    description: 'Internal user role',
    example: 'super_admin',
    enum: ['super_admin', 'staff_entry'],
  })
  role: string;
}
