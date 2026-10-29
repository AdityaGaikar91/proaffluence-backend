import * as crypto from 'crypto';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../core/prisma/prisma.service';
import { MailService } from '../core/mail/mail.service';
import { auth } from './auth';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async requestPasswordReset(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Timing-attack / user-enumeration prevention:
    // If the user does not exist, return generic success without revealing existence
    if (!user) {
      this.logger.warn(
        `Password reset requested for non-existent email address: ${email}`,
      );
      return {
        status: true,
        message:
          'If this email exists in our system, a password reset link has been sent.',
      };
    }

    // Generate secure one-time token (RFC 4122 UUID v4)
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour TTL

    // Clean up any old, unconsumed reset tokens for this user
    await this.prisma.verification.deleteMany({
      where: { value: user.id },
    });

    // Save token in the verifications table
    await this.prisma.verification.create({
      data: {
        identifier: `reset-password:${token}`,
        value: user.id,
        expiresAt,
      },
    });

    // Determine the base reset page URL
    const defaultFrontend =
      this.configService
        .get<string>('FRONTEND_ORIGINS', 'http://localhost:3000')
        .split(',')[0]
        .trim() || 'http://localhost:3000';

    const baseUrl = dto.redirectTo || `${defaultFrontend}/reset-password`;
    const separator = baseUrl.includes('?') ? '&' : '?';
    const resetUrl = `${baseUrl}${separator}token=${token}`;

    // Dispatch email via MailService (SMTP in production, console logger in dev)
    await this.mailService.sendPasswordResetEmail(user.email, resetUrl);

    return {
      status: true,
      message:
        'If this email exists in our system, a password reset link has been sent.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const { token, newPassword } = dto;
    const identifier = `reset-password:${token}`;

    // 1. Look up verification record
    const verification = await this.prisma.verification.findFirst({
      where: { identifier },
    });

    // 2. Validate token existence and expiration
    if (!verification || verification.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const userId = verification.value;

    // 3. Hash the new password using Better Auth's configured password hasher
    const ctx = await auth.$context;
    const hashedPassword = await ctx.password.hash(newPassword);

    // 4. Update the password in the accounts table
    const account = await this.prisma.account.findFirst({
      where: { userId, providerId: 'credential' },
    });

    if (!account) {
      throw new BadRequestException(
        'No credential account found for this user',
      );
    }

    await this.prisma.account.update({
      where: { id: account.id },
      data: { password: hashedPassword },
    });

    // 5. Consume token (Single-use guarantee: delete it immediately)
    await this.prisma.verification.delete({
      where: { id: verification.id },
    });

    // 6. Revoke all active sessions for this user across all devices
    await this.prisma.session.deleteMany({
      where: { userId },
    });

    this.logger.log(`Password successfully reset for user: ${userId}`);

    return {
      status: true,
      message:
        'Password has been reset successfully. Please log in with your new password.',
    };
  }
}
