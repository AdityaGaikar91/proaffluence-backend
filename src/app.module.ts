import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from './core/config/env.validation';
import { appConfig } from './core/config/app.config';
import { authConfig } from './core/config/auth.config';
import { PrismaModule } from './core/prisma/prisma.module';
import { MailModule } from './core/mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';
import { CashflowsModule } from './cashflows/cashflows.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [appConfig, authConfig],
    }),
    PrismaModule,
    MailModule,
    AuthModule,
    HealthModule,
    MeModule,
    CashflowsModule,
  ],
})
export class AppModule {}
