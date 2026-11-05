import { Injectable } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { PdfGeneratorService } from './pdf-generator.service';
import { OTemplateEngine } from './o-template.engine';
import { MetricsService } from '../core/observability/metrics.service';

/**
 * Thin facade over calc → workbook → PDF pipeline (Phase 3 split entrypoint).
 * Keeps ReportsService as the domain API while isolating orchestration.
 */
@Injectable()
export class ReportOrchestratorService {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly pdfGenerator: PdfGeneratorService,
    private readonly oTemplateEngine: OTemplateEngine,
    private readonly metrics: MetricsService,
  ) {}

  async calculateAndSnapshot(
    dto: { period: string; groupHeadId: string },
    user: { id: string; name: string },
  ) {
    const started = Date.now();
    const result = await this.reportsService.executeCalculationRun(dto, user);
    this.metrics.observeDuration('report.calculate', Date.now() - started);
    this.metrics.incr('report.calculate.completed');
    return result;
  }

  async generateClientPdf(params: {
    groupHeadId: string;
    period?: string;
    encrypted?: boolean;
  }) {
    const started = Date.now();
    const pdf = await this.reportsService.generateClientPdf(params);
    this.metrics.observeDuration('report.pdf', Date.now() - started);
    this.metrics.recordPdfEngine(pdf.engine, params.encrypted ?? true);
    return pdf;
  }

  /** Expose engine for advanced workbook fills without growing ReportsService. */
  get templateEngine(): OTemplateEngine {
    return this.oTemplateEngine;
  }

  get pdf(): PdfGeneratorService {
    return this.pdfGenerator;
  }
}
