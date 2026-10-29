import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import { CreateGroupHeadDto } from './dto/create-group-head.dto';
import { UpdateGroupHeadDto } from './dto/update-group-head.dto';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { QueryGroupHeadDto } from './dto/query-group-head.dto';
import { AssetCategory, AuditAction, Prisma } from '@prisma/client';

@Injectable()
export class GroupHeadsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all group heads with search, status/category filters, summary metrics, and pagination.
   */
  async findAll(query: QueryGroupHeadDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 50;
    const skip = (page - 1) * limit;

    const where: Prisma.GroupHeadWhereInput = {};

    // Filter: Operational Status
    if (query.status && query.status !== 'All') {
      where.status = query.status;
    }

    // Filter: Asset Category
    if (query.category) {
      where.categories = {
        has: query.category,
      };
    }

    // Filter: Search across Name, Custom ID, Contact Person, Email, and PAN
    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { customId: { contains: term, mode: 'insensitive' } },
        { contactPerson: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { pan: { contains: term, mode: 'insensitive' } },
      ];
    }

    // Allowed sort fields
    const validSortFields = [
      'name',
      'customId',
      'createdAt',
      'inceptionDate',
      'totalAum',
      'netInvestment',
    ];
    const sortField = validSortFields.includes(query.sortBy || '')
      ? (query.sortBy as string)
      : 'name';
    const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';

    // Execute paginated queries and summary aggregations concurrently
    const [total, activeCount, inactiveCount, aggregateAum, records] =
      await Promise.all([
        this.prisma.groupHead.count({ where }),
        this.prisma.groupHead.count({ where: { ...where, status: 'Active' } }),
        this.prisma.groupHead.count({
          where: { ...where, status: 'Inactive' },
        }),
        this.prisma.groupHead.aggregate({
          where,
          _sum: {
            totalAum: true,
            netInvestment: true,
          },
        }),
        this.prisma.groupHead.findMany({
          where,
          include: {
            familyMembers: {
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { [sortField]: sortOrder },
          skip,
          take: limit,
        }),
      ]);

    // Format response ensuring frontend compatibility with string[] familyMembers and detailed members
    const formattedData = records.map((head) => ({
      id: head.id,
      customId: head.customId,
      name: head.name,
      contactPerson: head.contactPerson ?? head.name,
      email: head.email,
      secondaryEmail: head.secondaryEmail ?? undefined,
      inceptionDate: head.inceptionDate,
      pan: head.pan,
      status: head.status,
      notes: head.notes ?? undefined,
      categories: head.categories,
      totalAum: Number(head.totalAum),
      netInvestment: Number(head.netInvestment),
      familyMembers: head.familyMembers.map((m) => m.name),
      members: head.familyMembers.map((m) => ({
        id: m.id,
        name: m.name,
        relationship: m.relationship ?? undefined,
        pan: m.pan ?? undefined,
        createdAt: m.createdAt,
      })),
      createdAt: head.createdAt,
      updatedAt: head.updatedAt,
    }));

    return {
      data: formattedData,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        activeCount,
        inactiveCount,
        totalAum: Number(aggregateAum._sum.totalAum || 0),
        netInvestment: Number(aggregateAum._sum.netInvestment || 0),
      },
    };
  }

  /**
   * Retrieve a single group head mandate by ID or customId.
   */
  async findOne(id: string) {
    const groupHead = await this.prisma.groupHead.findFirst({
      where: {
        OR: [{ id }, { customId: id }],
      },
      include: {
        familyMembers: {
          orderBy: { name: 'asc' },
        },
        _count: {
          select: {
            cashflows: true,
            closingBalances: true,
            emailCampaigns: true,
          },
        },
      },
    });

    if (!groupHead) {
      throw new NotFoundException(`Group Head with ID "${id}" was not found.`);
    }

    return {
      id: groupHead.id,
      customId: groupHead.customId,
      name: groupHead.name,
      contactPerson: groupHead.contactPerson ?? groupHead.name,
      email: groupHead.email,
      secondaryEmail: groupHead.secondaryEmail ?? undefined,
      inceptionDate: groupHead.inceptionDate,
      pan: groupHead.pan,
      status: groupHead.status,
      notes: groupHead.notes ?? undefined,
      categories: groupHead.categories,
      totalAum: Number(groupHead.totalAum),
      netInvestment: Number(groupHead.netInvestment),
      familyMembers: groupHead.familyMembers.map((m) => m.name),
      members: groupHead.familyMembers.map((m) => ({
        id: m.id,
        name: m.name,
        relationship: m.relationship ?? undefined,
        pan: m.pan ?? undefined,
        createdAt: m.createdAt,
      })),
      counts: {
        cashflows: groupHead._count.cashflows,
        closingBalances: groupHead._count.closingBalances,
        emailCampaigns: groupHead._count.emailCampaigns,
      },
      createdAt: groupHead.createdAt,
      updatedAt: groupHead.updatedAt,
    };
  }

  /**
   * Register a new Group Head mandate with atomic customId sequencing and initial family members.
   */
  async create(
    dto: CreateGroupHeadDto,
    currentUser?: { id: string; name?: string },
  ) {
    const actorName = currentUser?.name || 'System Admin';
    const actorId = currentUser?.id;

    return this.prisma.$transaction(async (tx) => {
      // 1. Verify entity name uniqueness
      const existingName = await tx.groupHead.findFirst({
        where: { name: { equals: dto.name.trim(), mode: 'insensitive' } },
      });

      if (existingName) {
        throw new ConflictException(
          `A Group Head with name "${dto.name}" already exists.`,
        );
      }

      // 2. Resolve or automatically assign sequential customId (e.g. GH-0105)
      let customId = dto.customId?.trim();
      if (!customId) {
        customId = await this.generateNextCustomId(tx);
      } else {
        const existingCustomId = await tx.groupHead.findUnique({
          where: { customId },
        });
        if (existingCustomId) {
          throw new ConflictException(
            `Custom ID "${customId}" is already registered.`,
          );
        }
      }

      // 3. Prepare initial family members
      const memberNames: string[] = [];
      if (Array.isArray(dto.familyMembers) && dto.familyMembers.length > 0) {
        dto.familyMembers.forEach((m) => {
          const trimmed = m.trim();
          if (trimmed && !memberNames.includes(trimmed)) {
            memberNames.push(trimmed);
          }
        });
      }

      // Ensure at least one member exists (primary contact or group head name)
      const primaryContact = (dto.contactPerson || dto.name).trim();
      if (memberNames.length === 0 && primaryContact) {
        memberNames.push(primaryContact);
      }

      // 4. Create Group Head record
      const categories: AssetCategory[] =
        dto.categories && dto.categories.length > 0
          ? dto.categories
          : [AssetCategory.MF, AssetCategory.PMS];

      const created = await tx.groupHead.create({
        data: {
          customId,
          name: dto.name.trim(),
          contactPerson: dto.contactPerson?.trim() || primaryContact,
          email: dto.email.trim().toLowerCase(),
          secondaryEmail: dto.secondaryEmail?.trim().toLowerCase() || null,
          inceptionDate: dto.inceptionDate.trim(),
          pan: dto.pan.trim().toUpperCase(),
          status: dto.status || 'Active',
          notes: dto.notes?.trim() || null,
          categories,
          familyMembers: {
            create: memberNames.map((name) => ({
              name,
              relationship: name === primaryContact ? 'Primary' : 'Member',
            })),
          },
        },
        include: {
          familyMembers: true,
        },
      });

      // 5. Record creation in Audit Trail if actorId exists
      if (actorId) {
        await tx.auditTrail.create({
          data: {
            action: AuditAction.CREATED,
            userId: actorId,
            userName: actorName,
            reason: `Registered new mandate "${created.name}" (${created.customId}).`,
          },
        });
      }

      return {
        id: created.id,
        customId: created.customId,
        name: created.name,
        contactPerson: created.contactPerson ?? created.name,
        email: created.email,
        secondaryEmail: created.secondaryEmail ?? undefined,
        inceptionDate: created.inceptionDate,
        pan: created.pan,
        status: created.status,
        notes: created.notes ?? undefined,
        categories: created.categories,
        totalAum: Number(created.totalAum),
        netInvestment: Number(created.netInvestment),
        familyMembers: created.familyMembers.map((m) => m.name),
        members: created.familyMembers.map((m) => ({
          id: m.id,
          name: m.name,
          relationship: m.relationship ?? undefined,
          pan: m.pan ?? undefined,
          createdAt: m.createdAt,
        })),
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };
    });
  }

  /**
   * Update Group Head details with cascading denormalized name update and audit recording.
   */
  async update(
    id: string,
    dto: UpdateGroupHeadDto,
    currentUser?: { id: string; name?: string },
  ) {
    const actorName = currentUser?.name || 'Staff User';
    const actorId = currentUser?.id;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.groupHead.findUnique({
        where: { id },
        include: { familyMembers: true },
      });

      if (!existing) {
        throw new NotFoundException(
          `Group Head with ID "${id}" was not found.`,
        );
      }

      // Check name uniqueness if name is updated
      if (
        dto.name &&
        dto.name.trim().toLowerCase() !== existing.name.toLowerCase()
      ) {
        const nameConflict = await tx.groupHead.findFirst({
          where: {
            name: { equals: dto.name.trim(), mode: 'insensitive' },
            id: { not: id },
          },
        });
        if (nameConflict) {
          throw new ConflictException(
            `A Group Head with name "${dto.name}" already exists.`,
          );
        }
      }

      // Check customId uniqueness if customId is updated
      if (dto.customId && dto.customId.trim() !== existing.customId) {
        const idConflict = await tx.groupHead.findUnique({
          where: { customId: dto.customId.trim() },
        });
        if (idConflict) {
          throw new ConflictException(
            `Custom ID "${dto.customId}" is already taken.`,
          );
        }
      }

      const newName = dto.name ? dto.name.trim() : existing.name;

      // Update Group Head
      const updated = await tx.groupHead.update({
        where: { id },
        data: {
          name: newName,
          customId: dto.customId ? dto.customId.trim() : existing.customId,
          contactPerson:
            dto.contactPerson !== undefined
              ? dto.contactPerson.trim()
              : existing.contactPerson,
          email: dto.email ? dto.email.trim().toLowerCase() : existing.email,
          secondaryEmail:
            dto.secondaryEmail !== undefined
              ? dto.secondaryEmail
                ? dto.secondaryEmail.trim().toLowerCase()
                : null
              : existing.secondaryEmail,
          inceptionDate: dto.inceptionDate
            ? dto.inceptionDate.trim()
            : existing.inceptionDate,
          pan: dto.pan ? dto.pan.trim().toUpperCase() : existing.pan,
          status: dto.status || existing.status,
          notes: dto.notes !== undefined ? dto.notes.trim() : existing.notes,
          categories: dto.categories || existing.categories,
        },
        include: {
          familyMembers: {
            orderBy: { name: 'asc' },
          },
        },
      });

      // Synchronize denormalized name in cashflows and closing balances if name changed
      if (dto.name && dto.name.trim() !== existing.name) {
        await tx.masterCashflow.updateMany({
          where: { groupHeadId: id },
          data: { groupHeadName: newName },
        });

        await tx.closingBalance.updateMany({
          where: { groupHeadId: id },
          data: { groupHeadName: newName },
        });
      }

      // Record audit diff if actorId exists
      if (actorId) {
        await tx.auditTrail.create({
          data: {
            action: AuditAction.CORRECTED,
            userId: actorId,
            userName: actorName,
            reason: `Updated details for mandate "${updated.name}" (${updated.customId}).`,
          },
        });
      }

      return {
        id: updated.id,
        customId: updated.customId,
        name: updated.name,
        contactPerson: updated.contactPerson ?? updated.name,
        email: updated.email,
        secondaryEmail: updated.secondaryEmail ?? undefined,
        inceptionDate: updated.inceptionDate,
        pan: updated.pan,
        status: updated.status,
        notes: updated.notes ?? undefined,
        categories: updated.categories,
        totalAum: Number(updated.totalAum),
        netInvestment: Number(updated.netInvestment),
        familyMembers: updated.familyMembers.map((m) => m.name),
        members: updated.familyMembers.map((m) => ({
          id: m.id,
          name: m.name,
          relationship: m.relationship ?? undefined,
          pan: m.pan ?? undefined,
          createdAt: m.createdAt,
        })),
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    });
  }

  /**
   * Toggle mandate active/inactive operational status.
   */
  async toggleStatus(
    id: string,
    status: 'Active' | 'Inactive',
    currentUser?: { id: string; name?: string },
  ) {
    const actorName = currentUser?.name || 'Staff User';
    const actorId = currentUser?.id;

    const groupHead = await this.prisma.groupHead.findUnique({
      where: { id },
    });

    if (!groupHead) {
      throw new NotFoundException(`Group Head with ID "${id}" was not found.`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.groupHead.update({
        where: { id },
        data: { status },
        include: { familyMembers: true },
      });

      if (actorId) {
        await tx.auditTrail.create({
          data: {
            action: AuditAction.CORRECTED,
            userId: actorId,
            userName: actorName,
            reason: `Changed operational status of "${groupHead.name}" to ${status}.`,
          },
        });
      }

      return res;
    });

    return {
      id: updated.id,
      customId: updated.customId,
      name: updated.name,
      status: updated.status,
      message: `Status updated to ${status}.`,
    };
  }

  /**
   * Delete Group Head. Rejects deletion if linked cashflows or closing balances exist.
   */
  async remove(id: string, currentUser?: { id: string; name?: string }) {
    const actorName = currentUser?.name || 'Manager';
    const actorId = currentUser?.id;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.groupHead.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              cashflows: true,
              closingBalances: true,
            },
          },
        },
      });

      if (!existing) {
        throw new NotFoundException(
          `Group Head with ID "${id}" was not found.`,
        );
      }

      if (
        existing._count.cashflows > 0 ||
        existing._count.closingBalances > 0
      ) {
        throw new BadRequestException(
          `Cannot delete Group Head "${existing.name}". It has ${existing._count.cashflows} cashflow entries and ${existing._count.closingBalances} closing balance records. Inactivate the record instead by changing status to "Inactive".`,
        );
      }

      await tx.groupHead.delete({
        where: { id },
      });

      if (actorId) {
        await tx.auditTrail.create({
          data: {
            action: AuditAction.VOIDED,
            userId: actorId,
            userName: actorName,
            reason: `Deleted mandate "${existing.name}" (${existing.customId}).`,
          },
        });
      }

      return {
        success: true,
        message: `Group Head "${existing.name}" was successfully deleted.`,
      };
    });
  }

  /**
   * Add a family member / beneficiary under a Group Head.
   */
  async addFamilyMember(
    groupHeadId: string,
    dto: CreateFamilyMemberDto,
    currentUser?: { id: string; name?: string },
  ) {
    const actorName = currentUser?.name || 'Staff User';
    const actorId = currentUser?.id;

    return this.prisma.$transaction(async (tx) => {
      const groupHead = await tx.groupHead.findUnique({
        where: { id: groupHeadId },
        include: { familyMembers: true },
      });

      if (!groupHead) {
        throw new NotFoundException(
          `Group Head with ID "${groupHeadId}" was not found.`,
        );
      }

      // Check unique member name under this mandate
      const duplicate = groupHead.familyMembers.find(
        (m) => m.name.toLowerCase() === dto.name.trim().toLowerCase(),
      );

      if (duplicate) {
        throw new ConflictException(
          `Family member "${dto.name}" is already registered under "${groupHead.name}".`,
        );
      }

      const createdMember = await tx.familyMember.create({
        data: {
          groupHeadId,
          name: dto.name.trim(),
          relationship: dto.relationship?.trim() || 'Member',
          pan: dto.pan?.trim().toUpperCase() || null,
        },
      });

      if (actorId) {
        await tx.auditTrail.create({
          data: {
            action: AuditAction.CREATED,
            userId: actorId,
            userName: actorName,
            reason: `Added family member "${createdMember.name}" to mandate "${groupHead.name}".`,
          },
        });
      }

      return {
        id: createdMember.id,
        groupHeadId: createdMember.groupHeadId,
        name: createdMember.name,
        relationship: createdMember.relationship ?? undefined,
        pan: createdMember.pan ?? undefined,
        createdAt: createdMember.createdAt,
      };
    });
  }

  /**
   * Remove a family member from a Group Head. Enforces minimum 1 member per mandate.
   */
  async removeFamilyMember(
    groupHeadId: string,
    memberId: string,
    currentUser?: { id: string; name?: string },
  ) {
    const actorName = currentUser?.name || 'Staff User';
    const actorId = currentUser?.id;

    return this.prisma.$transaction(async (tx) => {
      const groupHead = await tx.groupHead.findUnique({
        where: { id: groupHeadId },
        include: { familyMembers: true },
      });

      if (!groupHead) {
        throw new NotFoundException(
          `Group Head with ID "${groupHeadId}" was not found.`,
        );
      }

      if (groupHead.familyMembers.length <= 1) {
        throw new BadRequestException(
          'A mandate must retain at least one family member.',
        );
      }

      const member = groupHead.familyMembers.find((m) => m.id === memberId);
      if (!member) {
        throw new NotFoundException(
          `Family member with ID "${memberId}" was not found under this mandate.`,
        );
      }

      // Check if this member is directly referenced in cashflows or balances
      const [cashflowRefCount, balanceRefCount] = await Promise.all([
        tx.masterCashflow.count({ where: { familyMemberId: memberId } }),
        tx.closingBalance.count({ where: { familyMemberId: memberId } }),
      ]);

      if (cashflowRefCount > 0 || balanceRefCount > 0) {
        throw new BadRequestException(
          `Cannot remove family member "${member.name}". They are associated with ${cashflowRefCount} cashflows and ${balanceRefCount} closing balances.`,
        );
      }

      await tx.familyMember.delete({
        where: { id: memberId },
      });

      if (actorId) {
        await tx.auditTrail.create({
          data: {
            action: AuditAction.VOIDED,
            userId: actorId,
            userName: actorName,
            reason: `Removed family member "${member.name}" from mandate "${groupHead.name}".`,
          },
        });
      }

      return {
        success: true,
        message: `Family member "${member.name}" was successfully removed.`,
      };
    });
  }

  /**
   * Get supported categories and sub-categories dictionary aligned with O_Template.
   */
  getCategories() {
    return {
      categories: [
        { key: AssetCategory.MF, label: 'Mutual Funds (MF)' },
        {
          key: AssetCategory.PMS,
          label: 'Portfolio Management Services (PMS)',
        },
        { key: AssetCategory.STOCKS, label: 'Direct Equity / Stocks (STOCKS)' },
      ],
      subCategories: [
        { key: 'EQUITY', label: 'Equity' },
        { key: 'DEBT', label: 'Debt' },
        { key: 'HYBRID', label: 'Hybrid (50% Equity / 50% Debt)' },
      ],
    };
  }

  /**
   * Helper: Generate next sequential Custom ID (e.g., "GH-0105").
   */
  private async generateNextCustomId(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const records = await tx.groupHead.findMany({
      where: {
        customId: { startsWith: 'GH-' },
      },
      select: { customId: true },
    });

    let maxNumber = 100;
    records.forEach((r) => {
      const match = r.customId.match(/^GH-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    });

    const nextNum = maxNumber + 1;
    const formatted =
      nextNum < 1000 ? String(nextNum).padStart(4, '0') : String(nextNum);
    return `GH-${formatted}`;
  }
}
