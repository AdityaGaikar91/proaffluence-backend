import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from './decorators/public.decorator';
import { PasswordResetService } from './password-reset.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('Auth')
@Controller('api/auth')
export class PasswordResetController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request password reset',
    description:
      'Generates a secure password reset token and sends an email with a reset link. Employs anti-enumeration protection.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Password reset request processed. Returns a generic confirmation message regardless of email existence.',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example:
            'If this email exists in our system, a password reset link has been sent.',
        },
      },
    },
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordResetService.requestPasswordReset(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete password reset',
    description:
      'Validates the one-time token, sets the new password, consumes the token, and revokes all active user sessions.',
  })
  @ApiResponse({
    status: 200,
    description: 'Password successfully reset.',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example:
            'Password has been reset successfully. Please log in with your new password.',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired token, or invalid password.',
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwordResetService.resetPassword(dto);
  }
}
