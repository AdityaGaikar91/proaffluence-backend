import { Injectable, Logger } from '@nestjs/common';

/**
 * Lightweight in-process metrics counters for job/fallback/send health.
 * Replace with Prometheus exporter when ops wiring is ready.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly counters = new Map<string, number>();
  private readonly timings: Array<{ name: string; ms: number; at: string }> = [];

  incr(name: string, by = 1) {
    this.counters.set(name, (this.counters.get(name) || 0) + by);
  }

  observeDuration(name: string, ms: number) {
    this.timings.push({ name, ms, at: new Date().toISOString() });
    if (this.timings.length > 500) this.timings.shift();
  }

  /** LO fallback rate should stay ~0 for encrypted client sends. */
  recordPdfEngine(engine: 'libreoffice' | 'pdfkit-fallback', encrypted: boolean) {
    this.incr(`pdf.engine.${engine}`);
    if (encrypted && engine === 'pdfkit-fallback') {
      this.incr('pdf.fallback.encrypted');
      this.logger.warn('Encrypted PDF used PDFKit fallback — should be blocked at send');
    }
  }

  snapshot() {
    return {
      counters: Object.fromEntries(this.counters),
      recentTimings: this.timings.slice(-20),
    };
  }
}
