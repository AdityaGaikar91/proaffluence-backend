/**
 * Process-wide LibreOffice concurrency gate (default 1).
 * Prevents a batch of ~250 PDF jobs from spawning 250 soffice processes.
 */
export class LibreOfficeSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrent = Number(process.env.LIBREOFFICE_CONCURRENCY || 1)) {}

  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export const libreOfficeSemaphore = new LibreOfficeSemaphore();
