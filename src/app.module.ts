import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from './core/config/env.validation';
import { appConfig } from './core/config/app.config';
import { authConfig } from './core/config/auth.config';
import { PrismaModule } from './core/prisma/prisma.module';
import { MailModule } from './core/mail/mail.module';
import { ReportingFreezeModule } from './core/reporting/reporting-freeze.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { CashflowsModule } from './cashflows/cashflows.module';
import { GroupHeadsModule } from './group-heads/group-heads.module';
import { ClosingBalancesModule } from './closing-balances/closing-balances.module';
import { BenchmarksModule } from './benchmarks/benchmarks.module';
import { ReportsModule } from './reports/reports.module';
import { CommunicationsModule } from './communications/communications.module';
import { JobsModule } from './jobs/jobs.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

const jobsEnabled = process.env.JOBS_ENABLED !== 'false';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [appConfig, authConfig],
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    ReportingFreezeModule,
    MailModule,
    AuthModule,
    HealthModule,
    CashflowsModule,
    GroupHeadsModule,
    ClosingBalancesModule,
    BenchmarksModule,
    ReportsModule,
    CommunicationsModule,
    ...(jobsEnabled ? [JobsModule] : []),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
