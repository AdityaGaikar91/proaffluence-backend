import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({
    description: 'Email address of the staff member',
    example: 'staff1@proaffluence.com',
  })
  @IsEmail({}, { message: 'Must be a valid email address' })
  @IsNotEmpty({ message: 'Email cannot be empty' })
  email: string;

  @ApiPropertyOptional({
    description: 'Optional frontend redirect URL for password reset page',
    example: 'http://localhost:3000/reset-password',
  })
  @IsOptional()
  @IsString({ message: 'redirectTo must be a string' })
  redirectTo?: string;
}
