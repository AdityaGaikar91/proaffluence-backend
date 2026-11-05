import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { ReportingFreezeService } from '../core/reporting/reporting-freeze.service';
import { QueryClosingBalanceDto } from './dto/query-closing-balance.dto';
import { UpdateClosingAmountsDto } from './dto/update-closing-amounts.dto';
import { InitializeMonthDto } from './dto/initialize-month.dto';
import { CreateClosingBalanceDto } from './dto/create-closing-balance.dto';
import { ReturnBalanceDto } from './dto/return-balance.dto';
import { ApproveMonthDto } from './dto/approve-month.dto';
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

export function deriveMonthKeyFromDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parts[2];
    const month = parts[1].padStart(2, '0');
    return `${year}-${month}`;
  }
  return dateStr;
}

export function monthLabelFromKey(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = parseInt(yearStr, 10);
  const monthIdx = parseInt(monthStr, 10) - 1;
  if (!isNaN(year) && monthIdx >= 0 && monthIdx < 12) {
    return `${MONTH_NAMES[monthIdx]} ${year}`;
  }
  return monthKey;
}

export function defaultDateForMonthKey(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (!isNaN(year) && !isNaN(month)) {
    const lastDay = new Date(year, month, 0).getDate();
    return `${String(lastDay).padStart(2, '0')}-${monthStr.padStart(2, '0')}-${yearStr}`;
  }
  return `30-${monthStr}-${yearStr}`;
}

export function isValidMonthKey(monthKey: string): boolean {
  if (!monthKey || typeof monthKey !== 'string') return false;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey);
}

export function isValidDateDdMmYyyy(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return false;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;

  const maxDays = new Date(year, month, 0).getDate();
  if (day < 1 || day > maxDays) return false;

  return true;
}

export function escapeSqlWildcards(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

const MAX_VALUATION_AMOUNT = 999999999999999; // 15 digits, safe within IEEE-754 and fits comfortably within Decimal(18,2)

@Injectable()
export class ClosingBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly freezeService: ReportingFreezeService,
  ) {}

  /**
   * List closing balances with server pagination, status counts, category and search filtering.
   */
  async findAll(query: QueryClosingBalanceDto) {
    const {
      monthKey,
      statusTab = 'ALL',
      search,
      category,
      groupHeadName,
    } = query;
    const { page, limit, skip, take, sortBy, sortOrder } =
      parsePaginationParams(query, 'srNo');

    // Base scope by monthKey if provided
    const scopeWhere: Prisma.ClosingBalanceWhereInput = {
      voided: false,
      ...(monthKey ? { monthKey } : {}),
    };

    // 1. Compute status counts for the selected scope
    const [allCount, pendingCount, approvedCount, returnedCount, missingCount] =
      await Promise.all([
        this.prisma.closingBalance.count({ where: scopeWhere }),
        this.prisma.closingBalance.count({
          where: { ...scopeWhere, approvalStatus: ApprovalStatus.PENDING },
        }),
        this.prisma.closingBalance.count({
          where: { ...scopeWhere, approvalStatus: ApprovalStatus.APPROVED },
        }),
        this.prisma.closingBalance.count({
          where: { ...scopeWhere, approvalStatus: ApprovalStatus.RETURNED },
        }),
        this.prisma.closingBalance.count({
          where: { ...scopeWhere, closingAmount: null },
        }),
      ]);

    // 2. Build where filter for paginated list
    const where: Prisma.ClosingBalanceWhereInput = { ...scopeWhere };

    if (statusTab === 'PENDING') {
      where.approvalStatus = ApprovalStatus.PENDING;
    } else if (statusTab === 'APPROVED') {
      where.approvalStatus = ApprovalStatus.APPROVED;
    } else if (statusTab === 'RETURNED') {
      where.approvalStatus = ApprovalStatus.RETURNED;
    }

    if (category && category.trim() && category.toUpperCase() !== 'ALL') {
      const catUpper = category.trim().toUpperCase();
      if (Object.values(AssetCategory).includes(catUpper as AssetCategory)) {
        where.category = catUpper as AssetCategory;
      } else {
        // Unknown category filter returns 0 rows
        where.id = '00000000-0000-0000-0000-000000000000';
      }
    }

    if (groupHeadName) {
      where.groupHeadName = { contains: groupHeadName, mode: 'insensitive' };
    }

    if (search && search.trim()) {
      const q = search.trim();
      const escapedQ = escapeSqlWildcards(q);
      const asNum = parseInt(q, 10);

      where.OR = [
        { groupHeadName: { contains: escapedQ, mode: 'insensitive' } },
        { familyMemberName: { contains: escapedQ, mode: 'insensitive' } },
        { subCategory: { contains: escapedQ, mode: 'insensitive' } },
        { month: { contains: escapedQ, mode: 'insensitive' } },
        ...(!isNaN(asNum) && String(asNum) === q ? [{ srNo: asNum }] : []),
      ];
    }

    const sortField =
      sortBy &&
      [
        'srNo',
        'dateOfEntry',
        'month',
        'closingAmount',
        'groupHeadName',
      ].includes(sortBy)
        ? sortBy
        : 'srNo';

    const [total, items] = await Promise.all([
      this.prisma.closingBalance.count({ where }),
      this.prisma.closingBalance.findMany({
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
        missing: missingCount,
      },
      meta,
      pagination: meta, // Backward compatibility alias
    };
  }

  /**
   * Return high-level summary metrics for a given cycle (total, missing, AUM).
   */
  async getSummary(monthKey: string) {
    if (!monthKey || !isValidMonthKey(monthKey)) {
      throw new BadRequestException(
        'Invalid monthKey. Expected YYYY-MM format with valid month (01-12).',
      );
    }

    const [
      totalRows,
      pendingCount,
      approvedCount,
      returnedCount,
      missingRows,
      filledRows,
    ] = await Promise.all([
      this.prisma.closingBalance.count({ where: { monthKey, voided: false } }),
      this.prisma.closingBalance.count({
        where: {
          monthKey,
          voided: false,
          approvalStatus: ApprovalStatus.PENDING,
        },
      }),
      this.prisma.closingBalance.count({
        where: {
          monthKey,
          voided: false,
          approvalStatus: ApprovalStatus.APPROVED,
        },
      }),
      this.prisma.closingBalance.count({
        where: {
          monthKey,
          voided: false,
          approvalStatus: ApprovalStatus.RETURNED,
        },
      }),
      this.prisma.closingBalance.findMany({
        where: { monthKey, voided: false, closingAmount: null },
        select: {
          id: true,
          srNo: true,
          groupHeadName: true,
          familyMemberName: true,
          category: true,
          subCategory: true,
        },
        take: 20, // Sample of missing entries
      }),
      this.prisma.closingBalance.aggregate({
        where: { monthKey, voided: false, closingAmount: { not: null } },
        _sum: { closingAmount: true },
        _count: { id: true },
      }),
    ]);

    const missingCount = totalRows - (filledRows._count.id ?? 0);
    const totalValuationAum = filledRows._sum.closingAmount
      ? Number(filledRows._sum.closingAmount)
      : 0;

    return {
      monthKey,
      month: monthLabelFromKey(monthKey),
      totalRows,
      filledCount: filledRows._count.id ?? 0,
      missingCount,
      pendingCount,
      approvedCount,
      returnedCount,
      totalValuationAum,
      hasMissing: missingCount > 0,
      missingSample: missingRows,
    };
  }

  /**
   * Option B: On-Demand Month Grid Initialization.
   * Scaffolds missing placeholder rows for active Group Heads and their portfolio mandates.
   */
  async initializeMonth(
    dto: InitializeMonthDto,
    currentUser: { id: string; name?: string },
  ) {
    const { monthKey } = dto;
    if (!isValidMonthKey(monthKey)) {
      throw new BadRequestException(
        'Invalid monthKey. Expected YYYY-MM format with valid month (01-12).',
      );
    }
    await this.freezeService.assertMonthKeyNotFrozen(monthKey);

    const actorName = currentUser.name || 'Staff User';
    const monthLabel = monthLabelFromKey(monthKey);
    const entryDate = defaultDateForMonthKey(monthKey);

    return this.prisma.$transaction(async (tx) => {
      // 1. Fetch all active Group Heads with family members
      const activeHeads = await tx.groupHead.findMany({
        where: { status: 'Active' },
        include: { familyMembers: true },
      });

      if (activeHeads.length === 0) {
        throw new BadRequestException(
          'No active Group Heads found to initialize.',
        );
      }

      // 2. Fetch existing rows for this monthKey to prevent duplicate creation
      const existing = await tx.closingBalance.findMany({
        where: { monthKey },
        select: {
          groupHeadId: true,
          familyMemberName: true,
          category: true,
          subCategory: true,
        },
      });

      const existingSet = new Set(
        existing.map(
          (e) =>
            `${e.groupHeadId}::${e.familyMemberName.toLowerCase()}::${e.category}::${e.subCategory.toLowerCase()}`,
        ),
      );

      // 3. Compute starting sequence number
      const lastRecord = await tx.closingBalance.findFirst({
        orderBy: { srNo: 'desc' },
        select: { srNo: true },
      });
      let currentSrNo = (lastRecord?.srNo ?? 0) + 1;

      // 4. Canonical categories and standard asset class sub-categories
      const standardScenarios: {
        category: AssetCategory;
        subCategory: string;
      }[] = [
        { category: AssetCategory.MF, subCategory: 'EQUITY' },
        { category: AssetCategory.MF, subCategory: 'DEBT' },
        { category: AssetCategory.MF, subCategory: 'HYBRID' },
        { category: AssetCategory.PMS, subCategory: 'EQUITY' },
        { category: AssetCategory.PMS, subCategory: 'DEBT' },
        { category: AssetCategory.PMS, subCategory: 'HYBRID' },
        { category: AssetCategory.STOCKS, subCategory: 'EQUITY' },
      ];

      const toCreate: Prisma.ClosingBalanceCreateManyInput[] = [];

      for (const head of activeHeads) {
        // Filter standard scenarios based on head's subscribed categories if defined
        const applicableScenarios =
          Array.isArray(head.categories) && head.categories.length > 0
            ? standardScenarios.filter((s) =>
                head.categories.some(
                  (c) => c.toUpperCase() === s.category.toUpperCase(),
                ),
              )
            : standardScenarios;

        // Use individual family members or fallback to head name
        const members =
          head.familyMembers.length > 0
            ? head.familyMembers
            : [{ id: null, name: head.name, pan: head.pan }];

        for (const member of members) {
          const pan = (member.pan || head.pan || 'PAN_NOT_FOUND').toUpperCase();

          for (const scenario of applicableScenarios) {
            const comboKey = `${head.id}::${member.name.toLowerCase()}::${scenario.category}::${scenario.subCategory.toLowerCase()}`;

            if (!existingSet.has(comboKey)) {
              toCreate.push({
                srNo: currentSrNo++,
                dateOfEntry: entryDate,
                userId: pan,
                monthKey,
                month: monthLabel,
                groupHeadId: head.id,
                groupHeadName: head.name,
                familyMemberId: member.id ?? null,
                familyMemberName: member.name,
                category: scenario.category,
                subCategory: scenario.subCategory,
                closingAmount: null, // Nullable until staff fills in value
                approvalStatus: ApprovalStatus.PENDING,
                voided: false,
                submittedById: currentUser.id,
                submittedByName: actorName,
                submittedAt: new Date(),
              });
              existingSet.add(comboKey);
            }
          }
        }
      }

      if (toCreate.length > 0) {
        const createdRows = await tx.closingBalance.createManyAndReturn({
          data: toCreate,
          select: { id: true },
        });

        await tx.auditTrail.createMany({
          data: createdRows.map((r) => ({
            action: AuditAction.CREATED,
            userId: currentUser.id,
            userName: actorName,
            reason: 'Month cycle grid initialization placeholder row.',
            balanceId: r.id,
            changes: {
              source: 'initialize-month',
            },
          })),
        });
      }

      const totalRowsForMonth = await tx.closingBalance.count({
        where: { monthKey },
      });

      return {
        monthKey,
        month: monthLabel,
        scaffoldedCount: toCreate.length,
        totalRows: totalRowsForMonth,
        message: `Successfully initialized ${toCreate.length} placeholder rows for ${monthLabel}.`,
      };
    });
  }

  /**
   * Option A: Batch Inline Cell Updates from Spreadsheet Matrix.
   * Updates multiple closing amounts in a single ACID transaction with audit trail diffs.
   */
  async updateBatch(
    dto: UpdateClosingAmountsDto,
    currentUser: { id: string; name?: string },
  ) {
    const { updates } = dto;
    const ids = Object.keys(updates);

    if (ids.length === 0) {
      return { updatedCount: 0, message: 'No updates provided.' };
    }

    const preview = await this.prisma.closingBalance.findMany({
      where: { id: { in: ids }, voided: false },
      select: { monthKey: true },
    });
    const monthKeys = [...new Set(preview.map((r) => r.monthKey))];
    for (const mk of monthKeys) {
      await this.freezeService.assertMonthKeyNotFrozen(mk);
    }

    // Strict validation of values: reject booleans, strings, negatives, non-finite, and overflow numbers
    for (const [id, rawVal] of Object.entries(updates)) {
      if (rawVal === null || rawVal === undefined) {
        continue;
      }
      if (
        typeof rawVal !== 'number' ||
        typeof rawVal === 'boolean' ||
        !Number.isFinite(rawVal)
      ) {
        throw new BadRequestException(
          `Invalid valuation amount for entry ${id}: must be a finite number or null.`,
        );
      }
      if (rawVal < 0) {
        throw new BadRequestException(
          `Invalid valuation amount for entry ${id}: amount cannot be negative.`,
        );
      }
      if (rawVal > MAX_VALUATION_AMOUNT) {
        throw new BadRequestException(
          `Invalid valuation amount for entry ${id}: amount exceeds maximum allowable limit (${MAX_VALUATION_AMOUNT}).`,
        );
      }
    }

    const actorName = currentUser.name || 'Staff User';

    return this.prisma.$transaction(async (tx) => {
      // Fetch existing records
      const existingRecords = await tx.closingBalance.findMany({
        where: { id: { in: ids }, voided: false },
      });

      const existingMap = new Map(existingRecords.map((r) => [r.id, r]));
      let updatedCount = 0;

      for (const id of ids) {
        const record = existingMap.get(id);
        if (!record) continue;

        const rawNewVal = updates[id];
        const newAmount =
          rawNewVal === null || rawNewVal === undefined
            ? null
            : new Prisma.Decimal(rawNewVal);

        const oldAmountVal = record.closingAmount
          ? Number(record.closingAmount)
          : null;
        const newAmountVal = newAmount ? Number(newAmount) : null;

        // Skip if value has not actually changed
        if (oldAmountVal === newAmountVal) {
          continue;
        }

        // Update record: reset approval to PENDING and completely clear old approval metadata
        await tx.closingBalance.update({
          where: { id },
          data: {
            closingAmount: newAmount,
            approvalStatus: ApprovalStatus.PENDING,
            returnReason: null,
            approvedById: null,
            approvedByName: null,
            approvedAt: null,
            submittedById: currentUser.id,
            submittedByName: actorName,
            submittedAt: new Date(),
          },
        });

        // Record audit trail event
        await tx.auditTrail.create({
          data: {
            action: AuditAction.CORRECTED,
            userId: currentUser.id,
            userName: actorName,
            reason: 'Matrix inline valuation update.',
            balanceId: id,
            changes: {
              closingAmount: {
                from: oldAmountVal,
                to: newAmountVal,
              },
            },
          },
        });

        updatedCount++;
      }

      return {
        updatedCount,
        message: `Successfully updated ${updatedCount} valuation amount(s).`,
      };
    });
  }

  /**
   * Manual Single Closing Balance Entry.
   */
  async create(
    dto: CreateClosingBalanceDto,
    currentUser: { id: string; name?: string; role?: string },
  ) {
    const actorName = currentUser.name || 'Staff User';
    const role = (currentUser.role || '').toLowerCase();
    const managerOverride =
      Boolean(dto.allowBackdatedEntry) &&
      (role === 'manager' || role === 'super_admin');

    const groupHeadName = dto.Group_Head_Name?.trim();
    const familyMemberName = dto.Family_Member_Name?.trim();
    const subCategory = dto.Sub_Category?.trim();

    if (!groupHeadName) {
      throw new BadRequestException(
        'Group_Head_Name cannot be empty or whitespace-only.',
      );
    }
    if (!familyMemberName) {
      throw new BadRequestException(
        'Family_Member_Name cannot be empty or whitespace-only.',
      );
    }
    if (!subCategory) {
      throw new BadRequestException(
        'Sub_Category cannot be empty or whitespace-only.',
      );
    }

    // Validate date format and calendar validity
    if (!isValidDateDdMmYyyy(dto.Date_Of_Entry)) {
      throw new BadRequestException(
        `Invalid Date_Of_Entry "${dto.Date_Of_Entry}": must be a valid calendar date in dd-MM-yyyy format.`,
      );
    }

    // Explicit monthKey that differs from Date_Of_Entry is allowed for any authenticated
    // role (historical import / staff backfill). Managers may also pass allowBackdatedEntry.
    const derivedMonthKey = deriveMonthKeyFromDate(dto.Date_Of_Entry);
    const explicitMonthKeyBackdate =
      Boolean(dto.monthKey) &&
      isValidMonthKey(dto.monthKey as string) &&
      dto.monthKey !== derivedMonthKey;
    const canBackdate = explicitMonthKeyBackdate || managerOverride;
    if (dto.monthKey && dto.monthKey !== derivedMonthKey && !canBackdate) {
      throw new BadRequestException(
        `Provided monthKey "${dto.monthKey}" does not match Date_Of_Entry "${dto.Date_Of_Entry}" (expected "${derivedMonthKey}"). Pass an explicit monthKey for historical backfills, or managers may pass allowBackdatedEntry=true.`,
      );
    }
    const monthKey = dto.monthKey || derivedMonthKey;

    if (!isValidMonthKey(monthKey)) {
      throw new BadRequestException(
        `Invalid monthKey "${monthKey}". Expected YYYY-MM format with valid month (01-12).`,
      );
    }
    await this.freezeService.assertMonthKeyNotFrozen(monthKey);

    // Validate Closing_Amount if provided (DTO already rounds to 2 dp)
    if (dto.Closing_Amount !== undefined && dto.Closing_Amount !== null) {
      if (
        typeof dto.Closing_Amount !== 'number' ||
        !Number.isFinite(dto.Closing_Amount)
      ) {
        throw new BadRequestException('Closing_Amount must be a valid number.');
      }
      if (dto.Closing_Amount < 0) {
        throw new BadRequestException('Closing_Amount cannot be negative.');
      }
      if (dto.Closing_Amount > MAX_VALUATION_AMOUNT) {
        throw new BadRequestException(
          `Closing_Amount exceeds maximum allowable limit (${MAX_VALUATION_AMOUNT}).`,
        );
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Resolve Group Head
        const groupHead = await tx.groupHead.findFirst({
          where: {
            name: { equals: groupHeadName, mode: 'insensitive' },
          },
          include: { familyMembers: true },
        });

        if (!groupHead) {
          throw new BadRequestException(
            `Group Head "${groupHeadName}" not found in registered directory.`,
          );
        }

        // 2. Same-month category+subCategory: Excel sums — aggregate into existing row
        const duplicate = await tx.closingBalance.findFirst({
          where: {
            monthKey,
            groupHeadId: groupHead.id,
            familyMemberName: { equals: familyMemberName, mode: 'insensitive' },
            category: dto.Category,
            subCategory: { equals: subCategory, mode: 'insensitive' },
            voided: false,
          },
        });

        if (duplicate) {
          const incoming =
            dto.Closing_Amount !== undefined && dto.Closing_Amount !== null
              ? Number(dto.Closing_Amount)
              : null;
          const prior =
            duplicate.closingAmount !== null &&
            duplicate.closingAmount !== undefined
              ? Number(duplicate.closingAmount)
              : null;
          const summed =
            incoming === null
              ? prior
              : prior === null
                ? incoming
                : Number((prior + incoming).toFixed(2));

          const updated = await tx.closingBalance.update({
            where: { id: duplicate.id },
            data: {
              closingAmount:
                summed === null ? null : new Prisma.Decimal(summed),
              dateOfEntry: dto.Date_Of_Entry,
              approvalStatus: ApprovalStatus.PENDING,
              returnReason: null,
              approvedById: null,
              approvedByName: null,
              approvedAt: null,
            },
          });

          await tx.auditTrail.create({
            data: {
              action: AuditAction.CORRECTED,
              userId: currentUser.id,
              userName: actorName,
              reason:
                'Aggregated same-month category/sub-category valuation (Excel sum parity).',
              balanceId: updated.id,
              changes: {
                priorClosingAmount: prior,
                addedClosingAmount: incoming,
                closingAmount: summed,
              },
            },
          });

          return updated;
        }

        // 3. Resolve or create Family Member
        let familyMember = groupHead.familyMembers.find(
          (m) => m.name.toLowerCase() === familyMemberName.toLowerCase(),
        );

        if (!familyMember) {
          familyMember = await tx.familyMember.create({
            data: {
              groupHeadId: groupHead.id,
              name: familyMemberName,
            },
          });
        }

        const monthLabel = dto.Month || monthLabelFromKey(monthKey);

        // 4. Compute sequential Sr_No
        let assignedSrNo = dto.Sr_No;
        if (assignedSrNo && assignedSrNo > 0) {
          const existingSrNo = await tx.closingBalance.findFirst({
            where: { srNo: assignedSrNo },
          });
          if (existingSrNo) {
            throw new ConflictException(
              `Closing balance entry with Sr_No ${assignedSrNo} already exists.`,
            );
          }
        } else {
          const lastRecord = await tx.closingBalance.findFirst({
            orderBy: { srNo: 'desc' },
            select: { srNo: true },
          });
          assignedSrNo = (lastRecord?.srNo ?? 0) + 1;
        }

        // 5. Create record
        const closingAmount =
          dto.Closing_Amount !== undefined && dto.Closing_Amount !== null
            ? new Prisma.Decimal(dto.Closing_Amount)
            : null;

        const record = await tx.closingBalance.create({
          data: {
            srNo: assignedSrNo,
            dateOfEntry: dto.Date_Of_Entry,
            userId: dto.User_Id || groupHead.pan || currentUser.id,
            monthKey,
            month: monthLabel,
            groupHeadId: groupHead.id,
            groupHeadName: groupHead.name,
            familyMemberId: familyMember?.id ?? null,
            familyMemberName,
            category: dto.Category,
            subCategory,
            closingAmount,
            approvalStatus: ApprovalStatus.PENDING,
            voided: false,
            submittedById: currentUser.id,
            submittedByName: actorName,
            submittedAt: new Date(),
          },
        });

        // 6. Record audit trail
        const backdateNote = explicitMonthKeyBackdate
          ? ` Backdated monthKey ${monthKey} vs Date_Of_Entry ${dto.Date_Of_Entry} (derived ${derivedMonthKey}).`
          : '';
        await tx.auditTrail.create({
          data: {
            action: AuditAction.CREATED,
            userId: currentUser.id,
            userName: actorName,
            reason: `Initial closing balance entry submitted via portal.${backdateNote}`,
            balanceId: record.id,
            changes: {
              srNo: assignedSrNo,
              closingAmount: dto.Closing_Amount ?? null,
              monthKey,
              dateOfEntry: dto.Date_Of_Entry,
              backdatedMonthKey: explicitMonthKeyBackdate,
              category: dto.Category,
              subCategory,
            },
          },
        });

        return record;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Closing balance entry already exists for this mandate in cycle ${monthKey}.`,
        );
      }
      throw error;
    }
  }

  /**
   * Find single closing balance with complete audit trail.
   */
  async findOne(id: string) {
    const entry = await this.prisma.closingBalance.findUnique({
      where: { id },
      include: {
        auditEntries: {
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Closing balance entry ${id} not found.`);
    }

    return entry;
  }

  /**
   * Manager approve single entry.
   */
  async approve(id: string, currentUser: { id: string; name?: string }) {
    const existing = await this.findOne(id);
    if (existing.voided) {
      throw new BadRequestException('Cannot approve a voided balance entry.');
    }
    if (
      existing.closingAmount === null ||
      existing.closingAmount === undefined
    ) {
      throw new BadRequestException(
        'Cannot approve a closing balance with no closing amount. Please enter a valuation first.',
      );
    }
    if (existing.approvalStatus === ApprovalStatus.APPROVED) {
      throw new BadRequestException(
        'Closing balance entry is already approved.',
      );
    }
    this.freezeService.assertNotSelfApprove(
      existing.submittedById,
      currentUser.id,
    );
    await this.freezeService.assertMonthKeyNotFrozen(existing.monthKey);

    const actorName = currentUser.name || 'Manager';

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.closingBalance.update({
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
          reason: 'Manager approved closing balance valuation.',
          balanceId: id,
        },
      });

      return updated;
    });
  }

  /**
   * Manager return single entry for correction with reason.
   */
  async returnForCorrection(
    id: string,
    dto: ReturnBalanceDto,
    currentUser: { id: string; name?: string },
  ) {
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException(
        'Return reason is required and cannot be empty.',
      );
    }

    const existing = await this.findOne(id);
    if (existing.voided) {
      throw new BadRequestException('Cannot return a voided balance entry.');
    }
    if (existing.approvalStatus === ApprovalStatus.APPROVED) {
      throw new BadRequestException(
        'Cannot return an already approved closing balance entry.',
      );
    }
    if (existing.approvalStatus !== ApprovalStatus.PENDING) {
      throw new BadRequestException(
        'Only pending closing balances can be returned for correction.',
      );
    }
    await this.freezeService.assertMonthKeyNotFrozen(existing.monthKey);

    const actorName = currentUser.name || 'Manager';
    const cleanReason = dto.reason.trim();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.closingBalance.update({
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
          balanceId: id,
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
      // Only select rows that exist, are not voided, are pending, and have a non-null closingAmount
      const eligibleRecords = await tx.closingBalance.findMany({
        where: {
          id: { in: uniqueIds },
          voided: false,
          approvalStatus: ApprovalStatus.PENDING,
          closingAmount: { not: null },
          NOT: { submittedById: currentUser.id },
        },
        select: { id: true, monthKey: true },
      });

      for (const r of eligibleRecords) {
        await this.freezeService.assertMonthKeyNotFrozen(r.monthKey);
      }

      const eligibleIds = eligibleRecords.map((r) => r.id);

      if (eligibleIds.length > 0) {
        await tx.closingBalance.updateMany({
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
              reason: 'Batch manager approval of closing balances.',
              balanceId: id,
            },
          });
        }
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
    if (!reason || !reason.trim()) {
      throw new BadRequestException(
        'A mandatory reason is required for batch returns.',
      );
    }

    const actorName = currentUser.name || 'Manager';
    const cleanReason = reason.trim();
    const uniqueIds = Array.from(new Set(ids));

    if (uniqueIds.length === 0) {
      return { returnedCount: 0 };
    }

    return this.prisma.$transaction(async (tx) => {
      // Only select rows that exist, are not voided, and are pending (cannot return approved or voided rows)
      const eligibleRecords = await tx.closingBalance.findMany({
        where: {
          id: { in: uniqueIds },
          voided: false,
          approvalStatus: ApprovalStatus.PENDING,
        },
        select: { id: true, monthKey: true },
      });

      for (const r of eligibleRecords) {
        await this.freezeService.assertMonthKeyNotFrozen(r.monthKey);
      }

      const eligibleIds = eligibleRecords.map((r) => r.id);

      if (eligibleIds.length > 0) {
        await tx.closingBalance.updateMany({
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
              balanceId: id,
            },
          });
        }
      }

      return { returnedCount: eligibleIds.length };
    });
  }

  /**
   * User Decision 4 + 3: One-Click Monthly Manager Approval with Missing Valuation Gate.
   */
  async approveMonth(
    dto: ApproveMonthDto,
    currentUser: { id: string; name?: string },
  ) {
    const { monthKey, allowMissingOverride, overrideReason } = dto;

    if (!isValidMonthKey(monthKey)) {
      throw new BadRequestException(
        'Invalid monthKey. Expected YYYY-MM format with valid month (01-12).',
      );
    }
    await this.freezeService.assertMonthKeyNotFrozen(monthKey);

    const actorName = currentUser.name || 'Manager';

    // 1. Verify existence of records for this month
    const totalCount = await this.prisma.closingBalance.count({
      where: { monthKey, voided: false },
    });

    if (totalCount === 0) {
      throw new NotFoundException(
        `No closing balances found for month cycle "${monthKey}".`,
      );
    }

    // 2. Check missing values
    const missingCount = await this.prisma.closingBalance.count({
      where: { monthKey, voided: false, closingAmount: null },
    });

    if (missingCount > 0) {
      if (!allowMissingOverride) {
        throw new BadRequestException(
          `Cannot approve cycle ${monthKey}: ${missingCount} valuation(s) are missing. Check summary and provide manager override with justification if intended.`,
        );
      }
      if (!overrideReason?.trim()) {
        throw new BadRequestException(
          `Manager override justification is mandatory when approving a cycle with ${missingCount} missing valuation(s).`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Find all pending records for this month
      const pendingRecords = await tx.closingBalance.findMany({
        where: {
          monthKey,
          voided: false,
          approvalStatus: ApprovalStatus.PENDING,
          NOT: { submittedById: currentUser.id },
          ...(!allowMissingOverride ? { closingAmount: { not: null } } : {}),
        },
        select: { id: true },
      });

      const pendingIds = pendingRecords.map((r) => r.id);

      if (pendingIds.length > 0) {
        await tx.closingBalance.updateMany({
          where: { id: { in: pendingIds } },
          data: {
            approvalStatus: ApprovalStatus.APPROVED,
            approvedById: currentUser.id,
            approvedByName: actorName,
            approvedAt: new Date(),
            returnReason: null,
          },
        });

        const auditReason =
          missingCount > 0
            ? `Monthly manager cycle approval with override for ${missingCount} missing valuation(s): ${overrideReason?.trim()}`
            : 'One-click monthly manager cycle approval.';

        for (const id of pendingIds) {
          await tx.auditTrail.create({
            data: {
              action: AuditAction.APPROVED,
              userId: currentUser.id,
              userName: actorName,
              reason: auditReason,
              balanceId: id,
            },
          });
        }
      }

      return {
        monthKey,
        approvedCount: pendingIds.length,
        missingCount,
        overridden: missingCount > 0 && Boolean(allowMissingOverride),
        message: `Successfully approved ${pendingIds.length} closing balance record(s) for ${monthLabelFromKey(monthKey)}.`,
      };
    });
  }
}
