import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../core/prisma/prisma.module';
import { HealthController } from './health.controller';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [HealthController],
})
export class HealthModule {}
