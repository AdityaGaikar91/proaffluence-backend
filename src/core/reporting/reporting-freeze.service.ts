import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Shared freeze + maker-checker gates for month-end reporting.
 */
@Injectable()
export class ReportingFreezeService {
  constructor(private readonly prisma: PrismaService) {}

  /** dd-MM-yyyy or YYYY-MM → YYYY-MM */
  static deriveMonthKey(periodOrDate: string): string {
    const trimmed = (periodOrDate || '').trim();
    if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
      const [, mm, yyyy] = trimmed.split('-');
      return `${yyyy}-${mm}`;
    }
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) {
      return trimmed;
    }
    // "September 2026" style
    const named = trimmed.match(
      /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i,
    );
    if (named) {
      const months = [
        'january',
        'february',
        'march',
        'april',
        'may',
        'june',
        'july',
        'august',
        'september',
        'october',
        'november',
        'december',
      ];
      const idx = months.indexOf(named[1].toLowerCase());
      if (idx >= 0) {
        return `${named[2]}-${String(idx + 1).padStart(2, '0')}`;
      }
    }
    throw new BadRequestException(
      `Cannot derive monthKey from "${periodOrDate}". Use dd-MM-yyyy or YYYY-MM.`,
    );
  }

  async isMonthKeyFrozen(monthKey: string): Promise<boolean> {
    const run = await this.prisma.reportingRun.findFirst({
      where: { monthKey, isFrozen: true },
      select: { id: true },
    });
    return !!run;
  }

  async isPeriodFrozen(period: string): Promise<boolean> {
    const run = await this.prisma.reportingRun.findUnique({
      where: { period },
      select: { isFrozen: true },
    });
    if (run) return run.isFrozen;
    const monthKey = ReportingFreezeService.deriveMonthKey(period);
    return this.isMonthKeyFrozen(monthKey);
  }

  /** Block ledger mutations while the reporting month is frozen. */
  async assertMonthKeyNotFrozen(monthKeyOrPeriod: string): Promise<void> {
    const monthKey = /^\d{4}-\d{2}$/.test(monthKeyOrPeriod.trim())
      ? monthKeyOrPeriod.trim()
      : ReportingFreezeService.deriveMonthKey(monthKeyOrPeriod);
    if (await this.isMonthKeyFrozen(monthKey)) {
      throw new ConflictException(
        `Reporting month ${monthKey} is frozen. Unfreeze the run before changing ledger data.`,
      );
    }
  }

  /** Calculate / send require an explicitly frozen run for the period. */
  async assertPeriodFrozenForDispatch(period: string): Promise<void> {
    const trimmed = (period || '').trim();
    const run = await this.prisma.reportingRun.findUnique({
      where: { period: trimmed },
      select: { isFrozen: true, monthKey: true },
    });
    if (!run?.isFrozen) {
      throw new ConflictException(
        `Reporting period ${trimmed} must be frozen before calculation or client email dispatch.`,
      );
    }
  }

  /** Maker-checker: submitter cannot approve their own entry. */
  assertNotSelfApprove(
    submittedById: string | null | undefined,
    currentUserId: string,
  ): void {
    if (submittedById && submittedById === currentUserId) {
      throw new ForbiddenException(
        'Maker-checker violation: the same user cannot submit and approve an entry.',
      );
    }
  }
}
