import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from './core/config/env.validation';
import { appConfig } from './core/config/app.config';
import { authConfig } from './core/config/auth.config';
import { PrismaModule } from './core/prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [appConfig, authConfig],
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    MeModule,
  ],
})
export class AppModule {}
