import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { ReportingFreezeService } from '../core/reporting/reporting-freeze.service';
import { CreateCashflowDto } from './dto/create-cashflow.dto';
import { UpdateCashflowDto } from './dto/update-cashflow.dto';
import { VoidCashflowDto } from './dto/void-cashflow.dto';
import { ReturnCashflowDto } from './dto/return-cashflow.dto';
import { QueryCashflowDto } from './dto/query-cashflow.dto';
import {
  ApprovalStatus,
  AssetCategory,
  AuditAction,
  Prisma,
} from '@prisma/client';
import {
  parsePaginationParams,
  createPaginationMeta,
} from '../core/pagination';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly freezeService: ReportingFreezeService,
  ) {}

  /**
   * Next global Sr_No for the Add Trade Entry preview (max existing + 1).
   */
  async getNextSrNo(): Promise<{ nextSrNo: number }> {
    const lastRecord = await this.prisma.masterCashflow.findFirst({
      orderBy: { srNo: 'desc' },
      select: { srNo: true },
    });
    return { nextSrNo: (lastRecord?.srNo ?? 0) + 1 };
  }

  /**
   * Record a new trade entry (Add Trade Entry Modal).
   */
  async create(
    dto: CreateCashflowDto,
    currentUser: { id: string; name?: string; role?: string },
  ) {
    const actorName = currentUser.name || 'Staff User';
    await this.freezeService.assertMonthKeyNotFrozen(dto.Transaction_Date);

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
      if (assignedSrNo && assignedSrNo > 0) {
        const existingSrNo = await tx.masterCashflow.findFirst({
          where: { srNo: assignedSrNo },
          select: { id: true },
        });
        if (existingSrNo) {
          throw new ConflictException(
            `Master cashflow entry with Sr_No ${assignedSrNo} already exists.`,
          );
        }
      } else {
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
      try {
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
      } catch (err: unknown) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException(
            `Master cashflow entry with Sr_No ${assignedSrNo} already exists.`,
          );
        }
        throw err;
      }
    });
  }

  /**
   * Query all cashflows with status tabs, search, and pagination.
   */
  async findAll(query: QueryCashflowDto) {
    const { statusTab = 'ALL', search, month, groupHeadName, category } = query;
    const { page, limit, skip, take, sortBy, sortOrder } =
      parsePaginationParams(query, 'srNo');

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

    if (category && category.trim() && category.toUpperCase() !== 'ALL') {
      const catUpper = category.trim().toUpperCase();
      if (Object.values(AssetCategory).includes(catUpper as AssetCategory)) {
        where.category = catUpper as AssetCategory;
      }
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

    const sortField =
      sortBy &&
      ['srNo', 'dateOfEntry', 'month', 'amounts', 'transactionDate'].includes(
        sortBy,
      )
        ? sortBy
        : 'srNo';

    const [total, items] = await Promise.all([
      this.prisma.masterCashflow.count({ where }),
      this.prisma.masterCashflow.findMany({
        where,
        orderBy: [{ [sortField]: sortOrder }, { id: 'asc' }],
        skip,
        take,
      }),
    ]);

    const meta = createPaginationMeta(total, page, limit);

    return {
      data: items,
      counts: {
        all: allCount,
        pending: pendingCount,
        approved: approvedCount,
        returned: returnedCount,
      },
      meta,
      pagination: meta, // Backward compatibility alias
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
    await this.freezeService.assertMonthKeyNotFrozen(
      dto.Transaction_Date || existing.transactionDate,
    );

    const actorName = currentUser.name || 'Staff User';

    return this.prisma.$transaction(async (tx) => {
      const nextAmounts =
        dto.Amounts !== undefined ? dto.Amounts : Number(existing.amounts);
      const nextNewInvestments =
        dto.New_Investments !== undefined
          ? dto.New_Investments
          : Number(existing.newInvestments);
      const nextProfitLoss =
        dto.Profit_Loss !== undefined
          ? dto.Profit_Loss
          : Number(existing.profitLoss);
      const nextXirr =
        dto.XIRR !== undefined ? dto.XIRR : Number(existing.xirr);
      const nextTransactionType =
        dto.Transaction_Type || existing.transactionType;
      const nextCategory = dto.Category || existing.category;
      const nextSubCategory = dto.Sub_Category || existing.subCategory;
      const nextClientOwner =
        dto.Client_Owner?.trim() || existing.clientOwner;
      const nextFamilyMemberName =
        dto.Family_Member_Name?.trim() || existing.familyMemberName;
      const nextTransactionDate =
        dto.Transaction_Date || existing.transactionDate;
      const nextUserId = dto.User_Id?.trim()
        ? dto.User_Id.trim().toUpperCase()
        : existing.userId;
      const nextGroupHeadName =
        dto.Group_Head_Name?.trim() || existing.groupHeadName;
      const nextMonth =
        dto.Month?.trim() ||
        (dto.Transaction_Date
          ? deriveMonthFromDate(dto.Transaction_Date)
          : existing.month);

      const changeRows: Array<{ field: string; from: string; to: string }> =
        [];
      const pushDiff = (
        field: string,
        from: string | number | null | undefined,
        to: string | number | null | undefined,
      ) => {
        const fromStr = from == null ? '' : String(from);
        const toStr = to == null ? '' : String(to);
        if (fromStr !== toStr) {
          changeRows.push({ field, from: fromStr, to: toStr });
        }
      };

      pushDiff('Amounts', Number(existing.amounts), nextAmounts);
      pushDiff(
        'New_Investments',
        Number(existing.newInvestments),
        nextNewInvestments,
      );
      pushDiff('Profit_Loss', Number(existing.profitLoss), nextProfitLoss);
      pushDiff('XIRR', Number(existing.xirr), nextXirr);
      pushDiff(
        'Transaction_Type',
        existing.transactionType,
        nextTransactionType,
      );
      pushDiff('Category', existing.category, nextCategory);
      pushDiff('Sub_Category', existing.subCategory, nextSubCategory);
      pushDiff('Client_Owner', existing.clientOwner, nextClientOwner);
      pushDiff(
        'Family_Member_Name',
        existing.familyMemberName,
        nextFamilyMemberName,
      );
      pushDiff(
        'Transaction_Date',
        existing.transactionDate,
        nextTransactionDate,
      );
      pushDiff('User_Id', existing.userId, nextUserId);
      pushDiff('Group_Head_Name', existing.groupHeadName, nextGroupHeadName);
      pushDiff('Month', existing.month, nextMonth);

      // Resolve group head + family member FK when mandate / beneficiary changes
      let nextGroupHeadId = existing.groupHeadId;
      let nextFamilyMemberId = existing.familyMemberId;

      const groupHeadChanged =
        nextGroupHeadName.trim().toLowerCase() !==
        existing.groupHeadName.trim().toLowerCase();
      const familyMemberChanged =
        nextFamilyMemberName.trim().toLowerCase() !==
        existing.familyMemberName.trim().toLowerCase();

      if (groupHeadChanged || familyMemberChanged) {
        const groupHead = await tx.groupHead.findFirst({
          where: groupHeadChanged
            ? {
                name: {
                  equals: nextGroupHeadName.trim(),
                  mode: 'insensitive',
                },
              }
            : { id: existing.groupHeadId },
          include: { familyMembers: true },
        });

        if (groupHead) {
          nextGroupHeadId = groupHead.id;
          const match = groupHead.familyMembers.find(
            (m) =>
              m.name.trim().toLowerCase() ===
              nextFamilyMemberName.trim().toLowerCase(),
          );
          nextFamilyMemberId = match?.id ?? null;
        } else if (familyMemberChanged) {
          nextFamilyMemberId = null;
        }
      }

      // Update entry and set status back to PENDING for manager review
      const updated = await tx.masterCashflow.update({
        where: { id },
        data: {
          amounts: nextAmounts,
          newInvestments: nextNewInvestments,
          profitLoss: nextProfitLoss,
          xirr: nextXirr,
          transactionType: nextTransactionType,
          category: nextCategory,
          subCategory: nextSubCategory,
          clientOwner: nextClientOwner,
          familyMemberName: nextFamilyMemberName,
          familyMemberId: nextFamilyMemberId,
          groupHeadId: nextGroupHeadId,
          groupHeadName: nextGroupHeadName,
          userId: nextUserId,
          month: nextMonth,
          transactionDate: nextTransactionDate,
          approvalStatus: ApprovalStatus.PENDING,
          returnReason: null,
          approvedById: null,
          approvedByName: null,
          approvedAt: null,
        },
      });

      // Append correction to audit trail (array shape matches UI + schema comment)
      await tx.auditTrail.create({
        data: {
          action: AuditAction.CORRECTED,
          userId: currentUser.id,
          userName: actorName,
          reason: dto.correctionReason,
          cashflowId: id,
          changes: changeRows,
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
    await this.freezeService.assertMonthKeyNotFrozen(existing.transactionDate);

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
    if (existing.approvalStatus === ApprovalStatus.APPROVED) {
      throw new BadRequestException('Cashflow entry is already approved.');
    }
    this.freezeService.assertNotSelfApprove(
      existing.submittedById,
      currentUser.id,
    );
    await this.freezeService.assertMonthKeyNotFrozen(existing.transactionDate);

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
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException(
        'Return reason is required and cannot be empty.',
      );
    }

    const existing = await this.findOne(id);
    if (existing.voided) {
      throw new BadRequestException('Cannot return a voided entry.');
    }
    if (existing.approvalStatus === ApprovalStatus.APPROVED) {
      throw new BadRequestException(
        'Cannot return an already approved cashflow entry.',
      );
    }
    if (existing.approvalStatus !== ApprovalStatus.PENDING) {
      throw new BadRequestException(
        'Only pending cashflows can be returned for correction.',
      );
    }
    await this.freezeService.assertMonthKeyNotFrozen(existing.transactionDate);

    const actorName = currentUser.name || 'Manager';
    const cleanReason = dto.reason.trim();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.masterCashflow.update({
        where: { id },
        data: {
          approvalStatus: ApprovalStatus.RETURNED,
          returnReason: cleanReason,
        },
      });

      await tx.auditTrail.create({
        data: {
          action: AuditAction.RETURNED,
          userId: currentUser.id,
          userName: actorName,
          reason: cleanReason,
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
    const uniqueIds = Array.from(new Set(ids));

    if (uniqueIds.length === 0) {
      return { approvedCount: 0 };
    }

    return this.prisma.$transaction(async (tx) => {
      const eligibleRecords = await tx.masterCashflow.findMany({
        where: {
          id: { in: uniqueIds },
          voided: false,
          approvalStatus: ApprovalStatus.PENDING,
          NOT: { submittedById: currentUser.id },
        },
        select: { id: true, transactionDate: true },
      });

      const eligibleIds: string[] = [];
      for (const r of eligibleRecords) {
        await this.freezeService.assertMonthKeyNotFrozen(r.transactionDate);
        eligibleIds.push(r.id);
      }

      if (eligibleIds.length === 0) {
        return { approvedCount: 0 };
      }

      await tx.masterCashflow.updateMany({
        where: { id: { in: eligibleIds } },
        data: {
          approvalStatus: ApprovalStatus.APPROVED,
          approvedById: currentUser.id,
          approvedByName: actorName,
          approvedAt: new Date(),
          returnReason: null,
        },
      });

      for (const id of eligibleIds) {
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

      return { approvedCount: eligibleIds.length };
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
    const uniqueIds = Array.from(new Set(ids));
    const cleanReason = reason.trim();

    if (uniqueIds.length === 0) {
      return { returnedCount: 0 };
    }

    return this.prisma.$transaction(async (tx) => {
      const eligibleRecords = await tx.masterCashflow.findMany({
        where: {
          id: { in: uniqueIds },
          voided: false,
          approvalStatus: ApprovalStatus.PENDING,
        },
        select: { id: true, transactionDate: true },
      });

      const eligibleIds: string[] = [];
      for (const r of eligibleRecords) {
        await this.freezeService.assertMonthKeyNotFrozen(r.transactionDate);
        eligibleIds.push(r.id);
      }

      if (eligibleIds.length === 0) {
        return { returnedCount: 0 };
      }

      await tx.masterCashflow.updateMany({
        where: { id: { in: eligibleIds } },
        data: {
          approvalStatus: ApprovalStatus.RETURNED,
          returnReason: cleanReason,
        },
      });

      for (const id of eligibleIds) {
        await tx.auditTrail.create({
          data: {
            action: AuditAction.RETURNED,
            userId: currentUser.id,
            userName: actorName,
            reason: cleanReason,
            cashflowId: id,
          },
        });
      }

      return { returnedCount: eligibleIds.length };
    });
  }
}
