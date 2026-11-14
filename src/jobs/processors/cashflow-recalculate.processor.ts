import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Prisma, AuditAction } from '@prisma/client';
import Decimal from 'decimal.js';
import { QUEUE_CASHFLOW_RECALCULATE } from '../job.constants';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CashflowMathService } from '../../cashflows/cashflow-math.service';

export interface RecalculateJobData {
  groupHeadId: string;
  familyMemberId?: string | null;
  category: any;
  subCategory: string;
  actorId?: string;
  actorName?: string;
}

@Processor(QUEUE_CASHFLOW_RECALCULATE, { concurrency: 2 })
export class CashflowRecalculateProcessor extends WorkerHost {
  private readonly logger = new Logger(CashflowRecalculateProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mathService: CashflowMathService,
  ) {
    super();
  }

  async process(job: Job<RecalculateJobData>): Promise<{ updatedCount: number }> {
    const { groupHeadId, familyMemberId, category, subCategory, actorId, actorName } =
      job.data;

    this.logger.log(
      `Starting cashflow cascade recalculation for groupHead=${groupHeadId}, category=${category}, subCategory=${subCategory}`,
    );

    return this.prisma.$transaction(
      async (tx) => {
        // Advisory lock scoped by mandate
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${groupHeadId}));`;

        // 1. Fetch all unvoided trades for this specific asset group
        const whereClause: Prisma.MasterCashflowWhereInput = {
          groupHeadId,
          category,
          subCategory: { equals: subCategory.trim(), mode: 'insensitive' },
          voided: false,
        };

        if (familyMemberId !== undefined) {
          whereClause.familyMemberId = familyMemberId;
        }

        const existingFlows = await tx.masterCashflow.findMany({
          where: whereClause,
        });

        if (existingFlows.length === 0) {
          return { updatedCount: 0 };
        }

        // 2. Map into CandidateCashflowRows
        const candidateRows = existingFlows.map((flow) => ({
          id: flow.id,
          transactionDate: flow.transactionDate,
          transactionType: flow.transactionType,
          groupHeadId: flow.groupHeadId,
          familyMemberId: flow.familyMemberId,
          category: flow.category,
          subCategory: flow.subCategory,
          amounts: Number(flow.amounts),
          // We let processSequence recompute derivative values
          newInvestments: null,
          profitLoss: null,
          xirr: null,
        }));

        const recomputed = this.mathService.processSequence([], candidateRows);

        let updatedCount = 0;
        const now = new Date();

        for (const item of recomputed) {
          const original = existingFlows.find((f) => f.id === item.id);
          if (!original) continue;

          const origNewInv = new Decimal(original.newInvestments).toNumber();
          const origPL = new Decimal(original.profitLoss).toNumber();
          const origXirr = new Decimal(original.xirr).toNumber();

          const hasChanged =
            origNewInv !== item.newInvestments ||
            origPL !== item.profitLoss ||
            origXirr !== item.xirr;

          if (hasChanged) {
            await tx.masterCashflow.update({
              where: { id: original.id },
              data: {
                newInvestments: item.newInvestments,
                profitLoss: item.profitLoss,
                xirr: item.xirr,
              },
            });

            await tx.auditTrail.create({
              data: {
                action: AuditAction.CORRECTED,
                userId: actorId || 'SYSTEM_WORKER',
                userName: actorName || 'Recalculation Worker',
                reason:
                  'Cascade recalculated after antecedent trade void/edit.',
                cashflowId: original.id,
                changes: {
                  prevNewInvestments: origNewInv,
                  newInvestments: item.newInvestments,
                  prevProfitLoss: origPL,
                  profitLoss: item.profitLoss,
                  prevXirr: origXirr,
                  xirr: item.xirr,
                },
                timestamp: now,
              },
            });

            updatedCount++;
          }
        }

        this.logger.log(
          `Cascade recalculation completed for groupHead=${groupHeadId}. Updated ${updatedCount} downstream rows.`,
        );

        return { updatedCount };
      },
      { timeout: 30000 },
    );
  }
}
