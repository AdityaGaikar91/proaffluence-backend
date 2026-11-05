import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: MailAttachment[];
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly defaultFrom: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT', 587);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const secure = this.configService.get<boolean>('SMTP_SECURE', false);

    this.defaultFrom =
      this.configService.get<string>(
        'SMTP_FROM',
        'ProAffluence Portal <noreply@proaffluence.com>',
      ) || 'ProAffluence Portal <noreply@proaffluence.com>';

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });
      this.logger.log(`SMTP Mailer initialized with host: ${host}:${port}`);
    } else {
      this.logger.log(
        'No SMTP credentials configured. Mailer running in Development Console mode.',
      );
    }
  }

  async sendMail(
    options: SendMailOptions,
  ): Promise<{ sent: boolean; method: 'smtp' | 'console'; messageId: string }> {
    const { to, subject, text, html, attachments } = options;
    const generatedMsgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: this.defaultFrom,
          to,
          subject,
          text,
          html,
          attachments,
        });
        const safeTo = this.redactEmail(to);
        this.logger.log(
          `Email successfully sent to ${safeTo} messageId=${info?.messageId || generatedMsgId}`,
        );
        return {
          sent: true,
          method: 'smtp',
          messageId: info?.messageId || generatedMsgId,
        };
      } catch (error: any) {
        this.logger.error(
          `Failed to send email to ${this.redactEmail(to)}: ${error.message}`,
          error.stack,
        );
        throw error;
      }
    }

    // Development Console Output — never dump full HTML body in production
    const isProd = process.env.NODE_ENV === 'production';
    this.logger.log(`[DEV EMAIL SIMULATION] to=${this.redactEmail(to)} subject=${subject}`);
    if (attachments && attachments.length > 0) {
      this.logger.log(
        `ATTACHMENTS: ${attachments.map((a) => `${a.filename} (${a.content.length} bytes)`).join(', ')}`,
      );
    }
    if (!isProd && text) {
      this.logger.debug(`BODY_TEXT_LEN=${text.length}`);
    }

    return { sent: true, method: 'console', messageId: generatedMsgId };
  }

  /** Log-safe email: keep domain, mask local-part. */
  private redactEmail(email: string): string {
    const at = email.indexOf('@');
    if (at <= 0) return '***';
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    const maskedLocal =
      local.length <= 2 ? '**' : `${local[0]}***${local[local.length - 1]}`;
    return `${maskedLocal}@${domain}`;
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    const subject = 'Password Reset Request - ProAffluence Portal';
    const text = `You requested to reset your password for the ProAffluence Portal.

Click the link below to set a new password (valid for 1 hour):
${resetUrl}

If you did not request this, please ignore this email.`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a1a;">Password Reset Request</h2>
        <p>You requested to reset your password for the <strong>ProAffluence Client Reporting Portal</strong>.</p>
        <p>Click the button below to set a new password. This link is valid for <strong>1 hour</strong> and can only be used once:</p>
        <div style="margin: 24px 0;">
          <a href="${resetUrl}" style="background-color: #0284c7; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Reset My Password
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">If the button does not work, copy and paste this link into your browser:</p>
        <p style="color: #0284c7; font-size: 13px; word-break: break-all;">${resetUrl}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">If you did not request this password reset, please ignore this email.</p>
      </div>
    `;

    await this.sendMail({ to, subject, text, html });
  }
}
