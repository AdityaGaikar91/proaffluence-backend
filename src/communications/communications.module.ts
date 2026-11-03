import { Module } from '@nestjs/common';
import { PrismaModule } from '../core/prisma/prisma.module';
import { MailModule } from '../core/mail/mail.module';
import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';

@Module({
  imports: [PrismaModule, MailModule, AuthModule, ReportsModule],
  controllers: [CommunicationsController],
  providers: [CommunicationsService],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
