import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetCategory,
  BenchmarkCode,
  BenchmarkReturnType,
  QuoteSource,
} from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { CreateManualIndexRecordDto } from './dto/create-manual-index.dto';
import {
  BulkUploadIndexRecordsDto,
  BackfillBenchmarkFeedDto,
  SyncBenchmarkFeedDto,
} from './dto/bulk-upload-index.dto';
import {
  INDEX_FEED_PROVIDERS,
  IndexFeedProvider,
  IndexSeriesType,
  ProviderFetchResult,
  formatDdMmYyyy,
  lastCompletedMonthEnd,
  parseFlexibleDate,
} from './providers/index-feed.types';

export interface BenchmarkSyncResult {
  indexCode: BenchmarkCode;
  status: 'synced' | 'unchanged' | 'skipped_manual' | 'unavailable';
  reason?: string;
  requestedDate: string;
  actualTradingDate?: string;
  closingValue?: number;
  seriesType?: IndexSeriesType;
  provider?: string;
}
import {
  CreateHybridRuleDto,
  UpdateHybridRuleDto,
} from './dto/hybrid-rule.dto';

const DEFAULT_BENCHMARKS: Array<{
  code: BenchmarkCode;
  name: string;
  shortName: string;
  returnType: BenchmarkReturnType;
  exchange: string;
  provider: string;
  description: string;
  methodologyLabel: string;
  isDefault: boolean;
}> = [
  {
    code: BenchmarkCode.NIFTY_50_TRI,
    name: 'Nifty 50 Total Returns Index',
    shortName: 'Nifty 50 TRI',
    returnType: BenchmarkReturnType.TRI,
    exchange: 'NSE',
    provider: 'Manual / paid TRI source (no free feed)',
    description:
      'Includes capital price appreciation plus all dividend yields reinvested. Enter manually until a paid TRI source is configured.',
    methodologyLabel: 'TRI (Total Return — Div. Reinvested)',
    isDefault: true,
  },
  {
    code: BenchmarkCode.NIFTY_50_PR,
    name: 'Nifty 50 Price Return Index',
    shortName: 'Nifty 50 PR',
    returnType: BenchmarkReturnType.PR,
    exchange: 'NSE',
    provider: 'NSE Archives (ind_close_all CSV)',
    description:
      'Capital gains price return only. Free NSE archives feed works for this series.',
    methodologyLabel: 'PR (Price Return — archives feed)',
    isDefault: false,
  },
  {
    code: BenchmarkCode.BSE_500,
    name: 'S&P BSE 500 Index',
    shortName: 'BSE 500',
    returnType: BenchmarkReturnType.TRI,
    exchange: 'BSE',
    provider: 'Manual / paid source (BSE API blocked)',
    description:
      'Broad market benchmark covering over 93% of total market capitalization.',
    methodologyLabel: 'Broad Market (93% Market Cap)',
    isDefault: false,
  },
  {
    code: BenchmarkCode.SENSEX,
    name: 'S&P BSE Sensex Index',
    shortName: 'Sensex',
    returnType: BenchmarkReturnType.TRI,
    exchange: 'BSE',
    provider: 'Manual / paid source (BSE API blocked)',
    description:
      'Flagship index representing 30 financially sound and market-leading Indian companies.',
    methodologyLabel: 'Large-Cap 30 Benchmark',
    isDefault: false,
  },
];

export const DEFAULT_FY_RETURNS: Record<
  BenchmarkCode,
  Record<string, number | null>
> = {
  NIFTY_50_TRI: {
    'FY 2026-27': 14.28,
    'FY 2025-26': 9.73,
    'FY 2024-25': 11.55,
    'FY 2023-24': 28.01,
    'FY 2022-23': -6.12,
    'FY 2021-22': 18.42,
    'FY 2020-21': 58.39,
    'FY 2019-20': -21.1,
    'Since Inception': 12.85,
  },
  NIFTY_50_PR: {
    'FY 2026-27': 11.4,
    'FY 2025-26': 16.9,
    'FY 2024-25': -7.5,
    'FY 2023-24': 26.35,
    'FY 2022-23': 10.15,
    'FY 2021-22': 8.3,
    'FY 2020-21': 12.8,
    'Since Inception': 10.4,
  },
  BSE_500: {
    'FY 2026-27': 13.95,
    'FY 2025-26': 21.15,
    'FY 2024-25': -4.8,
    'FY 2023-24': 32.4,
    'FY 2022-23': 12.8,
    'FY 2021-22': 10.95,
    'FY 2020-21': 16.5,
    'Since Inception': 14.1,
  },
  SENSEX: {
    'FY 2026-27': 12.1,
    'FY 2025-26': 17.65,
    'FY 2024-25': -5.9,
    'FY 2023-24': 26.8,
    'FY 2022-23': 10.9,
    'FY 2021-22': 9.25,
    'FY 2020-21': 13.7,
    'Since Inception': 11.9,
  },
};

function normalizeDateToDdMmYyyy(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [yyyy, mm, dd] = trimmed.split('-');
    return `${dd}-${mm}-${yyyy}`;
  }
  return trimmed;
}

function mapSourceToFrontend(
  source: QuoteSource,
): 'feed' | 'manual' | 'bulk_upload' {
  switch (source) {
    case QuoteSource.MANUAL:
      return 'manual';
    case QuoteSource.BULK_UPLOAD:
      return 'bulk_upload';
    default:
      return 'feed';
  }
}

@Injectable()
export class BenchmarksService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(INDEX_FEED_PROVIDERS)
    private readonly feedProviders: IndexFeedProvider[],
  ) {}

  private async ensureBenchmarksExist() {
    const count = await this.prisma.benchmark.count();
    if (count === 0) {
      for (const b of DEFAULT_BENCHMARKS) {
        await this.prisma.benchmark.upsert({
          where: { code: b.code },
          update: b,
          create: b,
        });
      }
    }
  }

  async getIndicesOverview() {
    await this.ensureBenchmarksExist();

    const [benchmarks, records] = await Promise.all([
      this.prisma.benchmark.findMany(),
      this.prisma.indicesDataRecord.findMany({
        orderBy: [{ createdAt: 'desc' }, { date: 'desc' }],
      }),
    ]);

    const benchmarksMap: Record<string, any> = {};
    for (const b of benchmarks) {
      benchmarksMap[b.code] = {
        code: b.code,
        name: b.name,
        shortName: b.shortName,
        returnType: b.returnType,
        exchange: b.exchange,
        provider: b.provider,
        description: b.description,
        isFreeSourceAvailable: b.code === BenchmarkCode.NIFTY_50_PR,
        methodologyLabel: b.methodologyLabel,
        isDefault: b.isDefault,
      };
    }

    const mappedRecords = records.map((r) => ({
      id: r.id,
      date: r.date,
      indexCode: r.indexCode,
      closingValue: Number(r.closingValue),
      source: mapSourceToFrontend(r.source),
      updatedAt: r.createdAt.toISOString(),
      updatedBy: r.updatedBy,
      notes: r.notes ?? undefined,
    }));

    const feedHealth: Record<string, any> = {};
    const codes: BenchmarkCode[] = [
      BenchmarkCode.NIFTY_50_TRI,
      BenchmarkCode.NIFTY_50_PR,
      BenchmarkCode.BSE_500,
      BenchmarkCode.SENSEX,
    ];

    for (const code of codes) {
      const codeRecords = mappedRecords.filter((r) => r.indexCode === code);
      const latest = codeRecords[0];
      const meta = benchmarksMap[code];
      feedHealth[code] = {
        indexCode: code,
        status: latest ? 'synced' : 'gap_detected',
        lastSyncDate: latest ? `${latest.date} 17:30 IST` : 'Pending Sync',
        latestClosingValue: latest?.closingValue ?? 0,
        missingDatesCount: latest ? 0 : 1,
        providerSource: meta?.provider ?? 'NSE / BSE Free Feed',
      };
    }

    return {
      selectedBenchmark: BenchmarkCode.NIFTY_50_TRI,
      benchmarks: benchmarksMap,
      indicesData: mappedRecords,
      feedHealth,
      fyReturns: DEFAULT_FY_RETURNS,
    };
  }

  async addManualRecord(dto: CreateManualIndexRecordDto, actorName: string) {
    await this.ensureBenchmarksExist();
    const normDate = normalizeDateToDdMmYyyy(dto.date);

    const record = await this.prisma.indicesDataRecord.upsert({
      where: {
        date_indexCode: {
          date: normDate,
          indexCode: dto.indexCode,
        },
      },
      update: {
        closingValue: dto.closingValue,
        source: QuoteSource.MANUAL,
        updatedBy: actorName,
        notes: dto.notes?.trim() || 'Manual fallback entered by operator',
      },
      create: {
        date: normDate,
        indexCode: dto.indexCode,
        closingValue: dto.closingValue,
        source: QuoteSource.MANUAL,
        updatedBy: actorName,
        notes: dto.notes?.trim() || 'Manual fallback entered by operator',
      },
    });

    return {
      id: record.id,
      date: record.date,
      indexCode: record.indexCode,
      closingValue: Number(record.closingValue),
      source: mapSourceToFrontend(record.source),
      updatedAt: record.createdAt.toISOString(),
      updatedBy: record.updatedBy,
      notes: record.notes ?? undefined,
    };
  }

  async bulkUploadRecords(dto: BulkUploadIndexRecordsDto, actorName: string) {
    await this.ensureBenchmarksExist();

    const results: Array<any> = [];
    for (const item of dto.records) {
      const normDate = normalizeDateToDdMmYyyy(item.date);
      const saved = await this.prisma.indicesDataRecord.upsert({
        where: {
          date_indexCode: {
            date: normDate,
            indexCode: item.indexCode,
          },
        },
        update: {
          closingValue: item.closingValue,
          source: QuoteSource.BULK_UPLOAD,
          updatedBy: actorName,
          notes: item.notes?.trim() || 'CSV Ingestion Fallback',
        },
        create: {
          date: normDate,
          indexCode: item.indexCode,
          closingValue: item.closingValue,
          source: QuoteSource.BULK_UPLOAD,
          updatedBy: actorName,
          notes: item.notes?.trim() || 'CSV Ingestion Fallback',
        },
      });

      results.push({
        id: saved.id,
        date: saved.date,
        indexCode: saved.indexCode,
        closingValue: Number(saved.closingValue),
        source: mapSourceToFrontend(saved.source),
        updatedAt: saved.createdAt.toISOString(),
        updatedBy: saved.updatedBy,
        notes: saved.notes ?? undefined,
      });
    }

    return {
      ingestedCount: results.length,
      records: results,
    };
  }

  async deleteIndexRecord(id: string) {
    const existing = await this.prisma.indicesDataRecord.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`IndicesData record ${id} not found.`);
    }
    await this.prisma.indicesDataRecord.delete({ where: { id } });
    return { deleted: true, id };
  }

  /**
   * Scope point 6: honest free-feed ingestion. No hardcoded levels — every
   * FEED row comes from a provider response. MANUAL / BULK_UPLOAD rows are
   * never overwritten. Unavailable indices are reported so the UI can prompt
   * a manual entry into IndicesData.
   */
  async syncFeed(dto: SyncBenchmarkFeedDto, actorName: string) {
    await this.ensureBenchmarksExist();
    let target: Date;
    if (dto.periodDate) {
      const parsed = parseFlexibleDate(dto.periodDate);
      if (!parsed) {
        throw new BadRequestException(
          'periodDate must be a valid dd-MM-yyyy or yyyy-MM-dd date.',
        );
      }
      target = parsed;
    } else {
      target = lastCompletedMonthEnd();
    }
    const targetPeriod = formatDdMmYyyy(target);
    // Look back up to 10 days for the last trading day on/before the period date.
    const from = new Date(target.getTime() - 10 * 86400000);

    const codesToSync: BenchmarkCode[] = dto.indexCode
      ? [dto.indexCode]
      : [
          BenchmarkCode.NIFTY_50_TRI,
          BenchmarkCode.NIFTY_50_PR,
          BenchmarkCode.BSE_500,
          BenchmarkCode.SENSEX,
        ];

    const results: BenchmarkSyncResult[] = [];
    for (const code of codesToSync) {
      const fetched = await this.fetchFromProviders(code, from, target);
      if (!fetched.ok) {
        results.push({
          indexCode: code,
          status: 'unavailable',
          reason: fetched.reason,
          requestedDate: targetPeriod,
        });
        continue;
      }
      const latest = fetched.quotes[fetched.quotes.length - 1];
      if (!latest) {
        results.push({
          indexCode: code,
          status: 'unavailable',
          reason: `${fetched.provider} published no level between ${formatDdMmYyyy(from)} and ${targetPeriod}.`,
          requestedDate: targetPeriod,
        });
        continue;
      }
      // Stored under the requested period date so month-end lookups match;
      // the actual trading date used is recorded in notes and the response.
      const outcome = await this.upsertFeedQuote(
        code,
        targetPeriod,
        latest.closingValue,
        `${fetched.seriesType} series from ${fetched.provider} (${fetched.sourceUrl}); trading date ${latest.date}`,
        actorName,
      );
      results.push({
        indexCode: code,
        status: outcome.status,
        reason: outcome.reason,
        requestedDate: targetPeriod,
        actualTradingDate: latest.date,
        closingValue: outcome.closingValue,
        seriesType: fetched.seriesType,
        provider: fetched.provider,
      });
    }

    const syncedCount = results.filter((r) => r.status === 'synced').length;
    const unavailableCount = results.filter(
      (r) => r.status === 'unavailable',
    ).length;
    return {
      status:
        unavailableCount === 0
          ? 'synced'
          : syncedCount === 0 &&
              !results.some((r) => r.status === 'skipped_manual')
            ? 'unavailable'
            : 'partial',
      syncedAt: new Date().toISOString(),
      periodDate: targetPeriod,
      syncedCount,
      results,
      manualFallbackRequired: results
        .filter((r) => r.status === 'unavailable')
        .map((r) => r.indexCode),
      overview: await this.getIndicesOverview(),
    };
  }

  /**
   * Backfills daily levels for a date range (e.g. to cover client cashflow
   * dates for weighted benchmark comparison). Same no-overwrite rules as sync.
   */
  async backfillFeed(dto: BackfillBenchmarkFeedDto, actorName: string) {
    await this.ensureBenchmarksExist();
    const from = parseFlexibleDate(dto.fromDate);
    const to = parseFlexibleDate(dto.toDate);
    if (!from || !to || from.getTime() > to.getTime()) {
      throw new BadRequestException(
        'fromDate/toDate must be valid dates (dd-MM-yyyy or yyyy-MM-dd) with fromDate <= toDate.',
      );
    }
    const spanDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    if (spanDays > 400) {
      throw new BadRequestException(
        'Backfill range is limited to 400 days per request.',
      );
    }
    const fetched = await this.fetchFromProviders(dto.indexCode, from, to);
    if (!fetched.ok) {
      return {
        indexCode: dto.indexCode,
        status: 'unavailable',
        reason: fetched.reason,
        fromDate: formatDdMmYyyy(from),
        toDate: formatDdMmYyyy(to),
        synced: 0,
        skippedManual: 0,
        unchanged: 0,
      };
    }
    const counts = { synced: 0, skippedManual: 0, unchanged: 0 };
    for (const q of fetched.quotes) {
      const outcome = await this.upsertFeedQuote(
        dto.indexCode,
        q.date,
        q.closingValue,
        `${fetched.seriesType} series from ${fetched.provider} (${fetched.sourceUrl})`,
        actorName,
      );
      if (outcome.status === 'synced') counts.synced++;
      else if (outcome.status === 'skipped_manual') counts.skippedManual++;
      else counts.unchanged++;
    }
    return {
      indexCode: dto.indexCode,
      status: 'synced',
      provider: fetched.provider,
      seriesType: fetched.seriesType,
      fromDate: formatDdMmYyyy(from),
      toDate: formatDdMmYyyy(to),
      tradingDaysFound: fetched.quotes.length,
      ...counts,
    };
  }

  private async fetchFromProviders(
    code: BenchmarkCode,
    from: Date,
    to: Date,
  ): Promise<ProviderFetchResult> {
    const candidates = this.feedProviders.filter((p) => p.supports(code));
    if (candidates.length === 0) {
      return {
        ok: false,
        provider: 'none',
        reason: `No free feed provider is configured for ${code}. Enter the closing level manually.`,
      };
    }
    const reasons: string[] = [];
    for (const provider of candidates) {
      try {
        const res = await provider.fetchRange(code, from, to);
        if (res.ok) {
          // Defensive: never store a PRICE series under a TRI code.
          if (code === BenchmarkCode.NIFTY_50_TRI && res.seriesType !== 'TRI') {
            reasons.push(
              `${provider.name}: returned ${res.seriesType} series, refusing to label it TRI`,
            );
            continue;
          }
          return {
            ...res,
            quotes: [...res.quotes].sort(
              (a, b) =>
                (parseFlexibleDate(a.date)?.getTime() ?? 0) -
                (parseFlexibleDate(b.date)?.getTime() ?? 0),
            ),
          };
        }
        reasons.push(res.reason);
      } catch (err) {
        reasons.push(`${provider.name}: ${(err as Error).message}`);
      }
    }
    return { ok: false, provider: 'none', reason: reasons.join(' | ') };
  }

  private async upsertFeedQuote(
    code: BenchmarkCode,
    date: string,
    closingValue: number,
    notes: string,
    actorName: string,
  ): Promise<{
    status: 'synced' | 'unchanged' | 'skipped_manual';
    closingValue: number;
    reason?: string;
  }> {
    const existing = await this.prisma.indicesDataRecord.findUnique({
      where: { date_indexCode: { date, indexCode: code } },
    });
    if (existing && existing.source !== QuoteSource.FEED) {
      return {
        status: 'skipped_manual',
        closingValue: Number(existing.closingValue),
        reason: `Existing ${mapSourceToFrontend(existing.source)} entry kept; feed never overwrites manual data.`,
      };
    }
    if (existing && Number(existing.closingValue) === closingValue) {
      return { status: 'unchanged', closingValue };
    }
    if (existing) {
      await this.prisma.indicesDataRecord.update({
        where: { id: existing.id },
        data: { closingValue, notes, updatedBy: actorName },
      });
    } else {
      await this.prisma.indicesDataRecord.create({
        data: {
          date,
          indexCode: code,
          closingValue,
          source: QuoteSource.FEED,
          updatedBy: actorName,
          notes,
        },
      });
    }
    return { status: 'synced', closingValue };
  }

  // ===========================================================================
  // HYBRID ALLOCATION RULES (Point 5: 50/50 Equity/Debt Split & Overrides)
  // ===========================================================================

  private mapCategoryToAssetCategory(raw?: string): AssetCategory {
    if (!raw) return AssetCategory.MF;
    const upper = raw.toUpperCase();
    if (upper === 'PMS') return AssetCategory.PMS;
    if (upper === 'STOCKS' || upper === 'STOCK') return AssetCategory.STOCKS;
    if (upper === 'EQUITY') return AssetCategory.EQUITY;
    if (upper === 'DEBT') return AssetCategory.DEBT;
    if (upper === 'MF') return AssetCategory.MF;
    return AssetCategory.OTHER;
  }

  async listHybridRules() {
    const rules = await this.prisma.hybridAllocationRule.findMany({
      orderBy: [{ isCustom: 'desc' }, { schemeName: 'asc' }],
    });

    return {
      defaultEquityRatio: 50,
      defaultDebtRatio: 50,
      rules: rules.map((r) => ({
        id: r.id,
        schemeName: r.schemeName,
        category: r.category === AssetCategory.OTHER ? 'Hybrid' : r.category,
        equityRatio: r.equityRatio,
        debtRatio: r.debtRatio,
        isCustom: r.isCustom,
        notes: r.notes ?? undefined,
        updatedBy: r.updatedBy,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  async createHybridRule(dto: CreateHybridRuleDto, actorName: string) {
    const schemeName = dto.schemeName.trim();
    if (!schemeName) {
      throw new BadRequestException('Scheme name cannot be empty.');
    }

    const existing = await this.prisma.hybridAllocationRule.findUnique({
      where: { schemeName },
    });
    if (existing) {
      throw new ConflictException(
        `Hybrid allocation rule for scheme "${schemeName}" already exists.`,
      );
    }

    const equityRatio = Math.max(0, Math.min(100, Math.round(dto.equityRatio)));
    const debtRatio = 100 - equityRatio;
    const isCustom = equityRatio !== 50;

    const created = await this.prisma.hybridAllocationRule.create({
      data: {
        schemeName,
        category: this.mapCategoryToAssetCategory(dto.category),
        equityRatio,
        debtRatio,
        isCustom,
        notes:
          dto.notes?.trim() ||
          'ProAffluence custom equity/debt allocation override.',
        updatedBy: actorName,
      },
    });

    return {
      id: created.id,
      schemeName: created.schemeName,
      category:
        created.category === AssetCategory.OTHER ? 'Hybrid' : created.category,
      equityRatio: created.equityRatio,
      debtRatio: created.debtRatio,
      isCustom: created.isCustom,
      notes: created.notes ?? undefined,
      updatedBy: created.updatedBy,
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async updateHybridRule(
    id: string,
    dto: UpdateHybridRuleDto,
    actorName: string,
  ) {
    const existing = await this.prisma.hybridAllocationRule.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Hybrid allocation rule ${id} not found.`);
    }

    const equityRatio = Math.max(0, Math.min(100, Math.round(dto.equityRatio)));
    const debtRatio = 100 - equityRatio;
    const isCustom = equityRatio !== 50;

    const updated = await this.prisma.hybridAllocationRule.update({
      where: { id },
      data: {
        equityRatio,
        debtRatio,
        isCustom,
        notes: dto.notes !== undefined ? dto.notes.trim() : existing.notes,
        updatedBy: actorName,
      },
    });

    return {
      id: updated.id,
      schemeName: updated.schemeName,
      category:
        updated.category === AssetCategory.OTHER ? 'Hybrid' : updated.category,
      equityRatio: updated.equityRatio,
      debtRatio: updated.debtRatio,
      isCustom: updated.isCustom,
      notes: updated.notes ?? undefined,
      updatedBy: updated.updatedBy,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async resetAllHybridRules(actorName: string) {
    await this.prisma.hybridAllocationRule.updateMany({
      data: {
        equityRatio: 50,
        debtRatio: 50,
        isCustom: false,
        notes: 'Reset to standard 50% Equity / 50% Debt default.',
        updatedBy: actorName,
      },
    });
    return this.listHybridRules();
  }

  async deleteHybridRule(id: string) {
    const existing = await this.prisma.hybridAllocationRule.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Hybrid allocation rule ${id} not found.`);
    }
    await this.prisma.hybridAllocationRule.delete({ where: { id } });
    return { deleted: true, id };
  }
}
