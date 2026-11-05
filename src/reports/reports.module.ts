import { Module } from '@nestjs/common';
import { PrismaModule } from '../core/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { MetricsService } from '../core/observability/metrics.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { OTemplateEngine } from './o-template.engine';
import { PdfGeneratorService } from './pdf-generator.service';
import { ReportOrchestratorService } from './report-orchestrator.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    OTemplateEngine,
    PdfGeneratorService,
    MetricsService,
    ReportOrchestratorService,
  ],
  exports: [
    ReportsService,
    OTemplateEngine,
    PdfGeneratorService,
    ReportOrchestratorService,
    MetricsService,
  ],
})
export class ReportsModule {}
