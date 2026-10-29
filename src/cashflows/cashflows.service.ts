import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { CreateCashflowDto } from './dto/create-cashflow.dto';
import { UpdateCashflowDto } from './dto/update-cashflow.dto';
import { VoidCashflowDto } from './dto/void-cashflow.dto';
import { ReturnCashflowDto } from './dto/return-cashflow.dto';
import { QueryCashflowDto } from './dto/query-cashflow.dto';
import { ApprovalStatus, AuditAction, Prisma } from '@prisma/client';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function deriveMonthFromDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const monthIdx = parseInt(parts[1], 10) - 1;
    const year = parts[2];
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${MONTH_NAMES[monthIdx]} ${year}`;
    }
  }
  return dateStr;
}

@Injectable()
export class CashflowsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a new trade entry (Add Trade Entry Modal).
   */
  async create(
    dto: CreateCashflowDto,
    currentUser: { id: string; name?: string; role?: string },
  ) {
    const actorName = currentUser.name || 'Staff User';

    return this.prisma.$transaction(async (tx) => {
      // 1. Resolve Group Head
      const groupHead = await tx.groupHead.findFirst({
        where: {
          name: { equals: dto.Group_Head_Name.trim(), mode: 'insensitive' },
        },
        include: { familyMembers: true },
      });

      if (!groupHead) {
        throw new BadRequestException(
          `Group Head "${dto.Group_Head_Name}" not found in registered directory.`,
        );
      }

      // 2. Resolve or automatically create Family Member if not present
      let familyMember = groupHead.familyMembers.find(
        (m) =>
          m.name.toLowerCase() === dto.Family_Member_Name.trim().toLowerCase(),
      );

      if (!familyMember && dto.Family_Member_Name.trim()) {
        familyMember = await tx.familyMember.create({
          data: {
            groupHeadId: groupHead.id,
            name: dto.Family_Member_Name.trim(),
          },
        });
      }

      // 3. Compute sequential Sr_No
      let assignedSrNo = dto.Sr_No;
      if (!assignedSrNo || assignedSrNo <= 0) {
        const lastRecord = await tx.masterCashflow.findFirst({
          orderBy: { srNo: 'desc' },
          select: { srNo: true },
        });
        assignedSrNo = (lastRecord?.srNo ?? 0) + 1;
      }

      // 4. Resolve Month label
      const monthLabel =
        dto.Month?.trim() || deriveMonthFromDate(dto.Transaction_Date);

      // 5. Create MasterCashflow entry
      const cashflow = await tx.masterCashflow.create({
        data: {
          srNo: assignedSrNo,
          dateOfEntry: dto.Date_Of_Entry,
          userId: dto.User_Id || currentUser.id,
          month: monthLabel,
          clientOwner: dto.Client_Owner,
          groupHeadId: groupHead.id,
          groupHeadName: groupHead.name,
          familyMemberId: familyMember?.id ?? null,
          familyMemberName: dto.Family_Member_Name.trim(),
          transactionDate: dto.Transaction_Date,
          transactionType: dto.Transaction_Type,
          category: dto.Category,
          subCategory: dto.Sub_Category,
          amounts: dto.Amounts,
          newInvestments: dto.New_Investments ?? 0,
          profitLoss: dto.Profit_Loss ?? 0,
          xirr: dto.XIRR ?? 0,
          approvalStatus: ApprovalStatus.PENDING,
          voided: false,
          submittedById: currentUser.id,
          submittedByName: actorName,
          submittedAt: new Date(),
        },
      });

      // 6. Record Initial Audit Trail event
      await tx.auditTrail.create({
        data: {
          action: AuditAction.CREATED,
          userId: currentUser.id,
          userName: actorName,
          reason: 'Initial trade entry submitted via portal.',
          cashflowId: cashflow.id,
          changes: {
            Sr_No: assignedSrNo,
            Amounts: dto.Amounts,
            Transaction_Type: dto.Transaction_Type,
            Category: dto.Category,
            Sub_Category: dto.Sub_Category,
          },
        },
      });

      return cashflow;
    });
  }

  /**
   * Query all cashflows with status tabs, search, and pagination.
   */
  async findAll(query: QueryCashflowDto) {
    const {
      statusTab = 'ALL',
      search,
      month,
      groupHeadName,
      page = 1,
      limit = 50,
    } = query;
    const skip = (page - 1) * limit;

    // 1. Calculate status counts
    const [allCount, pendingCount, approvedCount, returnedCount] =
      await Promise.all([
        this.prisma.masterCashflow.count({ where: { voided: false } }),
        this.prisma.masterCashflow.count({
          where: { voided: false, approvalStatus: ApprovalStatus.PENDING },
        }),
        this.prisma.masterCashflow.count({
          where: { voided: false, approvalStatus: ApprovalStatus.APPROVED },
        }),
        this.prisma.masterCashflow.count({
          where: { voided: false, approvalStatus: ApprovalStatus.RETURNED },
        }),
      ]);

    // 2. Build where filter
    const where: Prisma.MasterCashflowWhereInput = {};

    if (statusTab === 'PENDING') {
      where.voided = false;
      where.approvalStatus = ApprovalStatus.PENDING;
    } else if (statusTab === 'APPROVED') {
      where.voided = false;
      where.approvalStatus = ApprovalStatus.APPROVED;
    } else if (statusTab === 'RETURNED') {
      where.voided = false;
      where.approvalStatus = ApprovalStatus.RETURNED;
    }

    if (month) {
      where.month = { equals: month, mode: 'insensitive' };
    }

    if (groupHeadName) {
      where.groupHeadName = { contains: groupHeadName, mode: 'insensitive' };
    }

    if (search && search.trim()) {
      const q = search.trim();
      const asNum = parseInt(q, 10);

      where.OR = [
        { groupHeadName: { contains: q, mode: 'insensitive' } },
        { familyMemberName: { contains: q, mode: 'insensitive' } },
        { clientOwner: { contains: q, mode: 'insensitive' } },
        { subCategory: { contains: q, mode: 'insensitive' } },
        { month: { contains: q, mode: 'insensitive' } },
        ...(!isNaN(asNum) ? [{ srNo: asNum }] : []),
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.masterCashflow.count({ where }),
      this.prisma.masterCashflow.findMany({
        where,
        orderBy: { srNo: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items,
      counts: {
        all: allCount,
        pending: pendingCount,
        approved: approvedCount,
        returned: returnedCount,
      },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find single entry by ID with complete audit history.
   */
  async findOne(id: string) {
    const entry = await this.prisma.masterCashflow.findUnique({
      where: { id },
      include: {
        auditEntries: {
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Master Cashflow entry ${id} not found.`);
    }

    return entry;
  }

  /**
   * Correct entry fields with mandatory correction reason.
   */
  async correct(
    id: string,
    dto: UpdateCashflowDto,
    currentUser: { id: string; name?: string },
  ) {
    const existing = await this.findOne(id);
    if (existing.voided) {
      throw new BadRequestException('Cannot correct a voided cashflow entry.');
    }

    const actorName = currentUser.name || 'Staff User';

    return this.prisma.$transaction(async (tx) => {
      // Prepare diffs
      const diffs: Record<string, { from: any; to: any }> = {};
      if (
        dto.Amounts !== undefined &&
        Number(existing.amounts) !== dto.Amounts
      ) {
        diffs.Amounts = { from: Number(existing.amounts), to: dto.Amounts };
      }
      if (
        dto.New_Investments !== undefined &&
        Number(existing.newInvestments) !== dto.New_Investments
      ) {
        diffs.New_Investments = {
          from: Number(existing.newInvestments),
          to: dto.New_Investments,
        };
      }
      if (
        dto.Profit_Loss !== undefined &&
        Number(existing.profitLoss) !== dto.Profit_Loss
      ) {
        diffs.Profit_Loss = {
          from: Number(existing.profitLoss),
          to: dto.Profit_Loss,
        };
      }
      if (dto.XIRR !== undefined && Number(existing.xirr) !== dto.XIRR) {
        diffs.XIRR = { from: Number(existing.xirr), to: dto.XIRR };
      }
      if (
        dto.Transaction_Type &&
        existing.transactionType !== dto.Transaction_Type
      ) {
        diffs.Transaction_Type = {
          from: existing.transactionType,
          to: dto.Transaction_Type,
        };
      }
      if (dto.Sub_Category && existing.subCategory !== dto.Sub_Category) {
        diffs.Sub_Category = {
          from: existing.subCategory,
          to: dto.Sub_Category,
        };
      }

      // Update entry and set status back to PENDING for manager review
      const updated = await tx.masterCashflow.update({
        where: { id },
        data: {
          amounts: dto.Amounts !== undefined ? dto.Amounts : existing.amounts,
          newInvestments:
            dto.New_Investments !== undefined
              ? dto.New_Investments
              : existing.newInvestments,
          profitLoss:
            dto.Profit_Loss !== undefined
              ? dto.Profit_Loss
              : existing.profitLoss,
          xirr: dto.XIRR !== undefined ? dto.XIRR : existing.xirr,
          transactionType: dto.Transaction_Type || existing.transactionType,
          category: dto.Category || existing.category,
          subCategory: dto.Sub_Category || existing.subCategory,
          clientOwner: dto.Client_Owner || existing.clientOwner,
          familyMemberName: dto.Family_Member_Name || existing.familyMemberName,
          transactionDate: dto.Transaction_Date || existing.transactionDate,
          approvalStatus: ApprovalStatus.PENDING,
          returnReason: null,
        },
      });

      // Append correction to audit trail
      await tx.auditTrail.create({
        data: {
          action: AuditAction.CORRECTED,
          userId: currentUser.id,
          userName: actorName,
          reason: dto.correctionReason,
          cashflowId: id,
          changes: diffs,
        },
      });

      return updated;
    });
  }

  /**
   * Void entry (marks voided: true with mandatory reason).
   */
  async void(
    id: string,
    dto: VoidCashflowDto,
    currentUser: { id: string; name?: string },
  ) {
    const existing = await this.findOne(id);
    if (existing.voided) {
      throw new BadRequestException('Entry is already voided.');
    }

    const actorName = currentUser.name || 'Manager User';

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.masterCashflow.update({
        where: { id },
        data: {
          voided: true,
          voidReason: dto.reason,
        },
      });

      await tx.auditTrail.create({
        data: {
          action: AuditAction.VOIDED,
          userId: currentUser.id,
          userName: actorName,
          reason: dto.reason,
          cashflowId: id,
        },
      });

      return updated;
    });
  }

  /**
   * Manager Approve single entry.
   */
  async approve(id: string, currentUser: { id: string; name?: string }) {
    const existing = await this.findOne(id);
    if (existing.voided) {
      throw new BadRequestException('Cannot approve a voided entry.');
    }

    const actorName = currentUser.name || 'Manager';

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.masterCashflow.update({
        where: { id },
        data: {
          approvalStatus: ApprovalStatus.APPROVED,
          approvedById: currentUser.id,
          approvedByName: actorName,
          approvedAt: new Date(),
          returnReason: null,
        },
      });

      await tx.auditTrail.create({
        data: {
          action: AuditAction.APPROVED,
          userId: currentUser.id,
          userName: actorName,
          reason: 'Manager approved trade entry.',
          cashflowId: id,
        },
      });

      return updated;
    });
  }

  /**
   * Manager Return single entry for correction with reason.
   */
  async returnForCorrection(
    id: string,
    dto: ReturnCashflowDto,
    currentUser: { id: string; name?: string },
  ) {
    const existing = await this.findOne(id);
    if (existing.voided) {
      throw new BadRequestException('Cannot return a voided entry.');
    }

    const actorName = currentUser.name || 'Manager';

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.masterCashflow.update({
        where: { id },
        data: {
          approvalStatus: ApprovalStatus.RETURNED,
          returnReason: dto.reason,
        },
      });

      await tx.auditTrail.create({
        data: {
          action: AuditAction.RETURNED,
          userId: currentUser.id,
          userName: actorName,
          reason: dto.reason,
          cashflowId: id,
        },
      });

      return updated;
    });
  }

  /**
   * Manager Bulk Approve multiple entries.
   */
  async bulkApprove(ids: string[], currentUser: { id: string; name?: string }) {
    const actorName = currentUser.name || 'Manager';

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.masterCashflow.updateMany({
        where: {
          id: { in: ids },
          voided: false,
          approvalStatus: ApprovalStatus.PENDING,
        },
        data: {
          approvalStatus: ApprovalStatus.APPROVED,
          approvedById: currentUser.id,
          approvedByName: actorName,
          approvedAt: new Date(),
          returnReason: null,
        },
      });

      for (const id of ids) {
        await tx.auditTrail.create({
          data: {
            action: AuditAction.APPROVED,
            userId: currentUser.id,
            userName: actorName,
            reason: 'Batch manager approval.',
            cashflowId: id,
          },
        });
      }

      return { approvedCount: result.count };
    });
  }

  /**
   * Manager Bulk Return multiple entries.
   */
  async bulkReturn(
    ids: string[],
    reason: string,
    currentUser: { id: string; name?: string },
  ) {
    const actorName = currentUser.name || 'Manager';

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.masterCashflow.updateMany({
        where: {
          id: { in: ids },
          voided: false,
        },
        data: {
          approvalStatus: ApprovalStatus.RETURNED,
          returnReason: reason,
        },
      });

      for (const id of ids) {
        await tx.auditTrail.create({
          data: {
            action: AuditAction.RETURNED,
            userId: currentUser.id,
            userName: actorName,
            reason,
            cashflowId: id,
          },
        });
      }

      return { returnedCount: result.count };
    });
  }
}
