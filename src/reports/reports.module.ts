import { Module } from '@nestjs/common';
import { PrismaModule } from '../core/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { OTemplateEngine } from './o-template.engine';
import { PdfGeneratorService } from './pdf-generator.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService, OTemplateEngine, PdfGeneratorService],
  exports: [ReportsService, OTemplateEngine, PdfGeneratorService],
})
export class ReportsModule {}
