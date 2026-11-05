import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportingFreezeService } from './reporting-freeze.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ReportingFreezeService],
  exports: [ReportingFreezeService],
})
export class ReportingFreezeModule {}
