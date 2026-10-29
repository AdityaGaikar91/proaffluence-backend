import 'reflect-metadata';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  validateSync,
} from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { auth } from '../src/auth/auth';
import { prisma } from '../src/core/prisma/prisma.service';
import {
  ApprovalStatus,
  AssetCategory,
  BenchmarkCode,
  BenchmarkReturnType,
  TransactionType,
  AuditAction,
} from '@prisma/client';

export class SeedUserDto {
  @IsEmail({}, { message: 'Must be a valid email address' })
  email: string;

  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name cannot be empty' })
  name: string;

  @IsString({ message: 'Password must be a string' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password: string;

  @IsOptional()
  @IsString({ message: 'Role must be a string' })
  @IsIn(['super_admin', 'manager', 'staff_entry'], {
    message: 'Role must be either "super_admin", "manager", or "staff_entry"',
  })
  role?: string = 'staff_entry';

  @IsOptional()
  @IsBoolean({ message: 'emailVerified must be a boolean' })
  emailVerified?: boolean = true;

  @IsOptional()
  @IsString({ message: 'image must be a string' })
  image?: string | null = null;

  @IsOptional()
  @IsBoolean({ message: 'banned must be a boolean' })
  banned?: boolean | null = false;

  @IsOptional()
  @IsString({ message: 'banReason must be a string' })
  banReason?: string | null = null;

  @IsOptional()
  banExpires?: string | Date | null = null;

  [key: string]: any;
}

export function validateSeedUser(data: unknown, index: number): SeedUserDto {
  const user = plainToInstance(SeedUserDto, data);
  const errors = validateSync(user, { whitelist: false });

  if (errors.length > 0) {
    const errorDetails = errors
      .map((e) => Object.values(e.constraints || {}).join(', '))
      .join('; ');
    throw new Error(
      `Seed validation failed for user at index ${index} (${(data as any)?.email || 'unknown'}): ${errorDetails}`,
    );
  }

  return user;
}

async function seedUser(userData: SeedUserDto) {
  const {
    email,
    name,
    password: rawPassword,
    role = 'staff_entry',
    emailVerified = true,
    image = null,
    banned = false,
    banReason = null,
    banExpires = null,
    ...extraFields
  } = userData;

  const ctx = await auth.$context;
  const { internalAdapter, password } = ctx;

  const result = await internalAdapter.findUserByEmail(email);
  const hashedPassword = await password.hash(rawPassword);

  const parsedBanExpires = banExpires ? new Date(banExpires) : null;

  const userPayload = {
    name,
    role,
    emailVerified,
    image,
    banned,
    banReason,
    banExpires: parsedBanExpires,
    ...extraFields,
  };

  if (result && result.user) {
    const userId = result.user.id;
    await internalAdapter.updateUser(userId, userPayload);

    const account = await internalAdapter.findCredentialAccount(userId);
    if (account) {
      await internalAdapter.updatePassword(userId, hashedPassword);
    } else {
      await internalAdapter.createAccount({
        userId,
        accountId: userId,
        providerId: 'credential',
        password: hashedPassword,
      });
    }

    console.log(`[Seed] Idempotently updated user: ${email} (role: ${role})`);
  } else {
    const userId = crypto.randomUUID();
    const accountId = crypto.randomUUID();

    const newUser = await internalAdapter.createUser(
      {
        id: userId,
        email,
        ...userPayload,
      },
      { method: 'email-password' },
    );

    await internalAdapter.createAccount({
      id: accountId,
      userId: newUser.id,
      accountId: newUser.id,
      providerId: 'credential',
      password: hashedPassword,
    });

    console.log(`[Seed] Created new user: ${email} (role: ${role}, id: ${newUser.id})`);
  }
}

async function seedGroupHeads() {
  const ghFilePath = path.join(__dirname, 'seeds', 'group-heads.json');
  if (!fs.existsSync(ghFilePath)) return;

  const rawData: any[] = JSON.parse(fs.readFileSync(ghFilePath, 'utf8'));
  for (const gh of rawData) {
    const { familyMembers, ...data } = gh;
    const existing = await prisma.groupHead.findUnique({ where: { customId: data.customId } });
    let groupHeadId = existing?.id;
    if (!existing) {
      const created = await prisma.groupHead.create({
        data: {
          id: data.id,
          customId: data.customId,
          name: data.name,
          contactPerson: data.contactPerson,
          email: data.email,
          secondaryEmail: data.secondaryEmail,
          inceptionDate: data.inceptionDate,
          pan: data.pan,
          status: data.status,
          notes: data.notes,
          categories: data.categories,
          totalAum: data.totalAum,
          netInvestment: data.netInvestment,
        },
      });
      groupHeadId = created.id;
      console.log(`[Seed] Created Group Head: ${data.name} (${data.customId})`);
    } else {
      await prisma.groupHead.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          contactPerson: data.contactPerson,
          email: data.email,
          secondaryEmail: data.secondaryEmail,
          inceptionDate: data.inceptionDate,
          pan: data.pan,
          status: data.status,
          notes: data.notes,
          categories: data.categories,
          totalAum: data.totalAum,
          netInvestment: data.netInvestment,
        },
      });
      console.log(`[Seed] Updated Group Head: ${data.name} (${data.customId})`);
    }

    if (groupHeadId && Array.isArray(familyMembers)) {
      for (const memberItem of familyMembers) {
        const name = typeof memberItem === 'string' ? memberItem : memberItem.name;
        const relationship = typeof memberItem === 'object' ? memberItem.relationship : undefined;
        const pan = typeof memberItem === 'object' ? memberItem.pan : undefined;

        const mem = await prisma.familyMember.findUnique({
          where: { groupHeadId_name: { groupHeadId, name } },
        });
        if (!mem) {
          await prisma.familyMember.create({
            data: { groupHeadId, name, relationship, pan },
          });
        } else if (relationship || pan) {
          await prisma.familyMember.update({
            where: { id: mem.id },
            data: { relationship, pan },
          });
        }
      }
    }
  }
}

async function seedBenchmarks() {
  const filePath = path.join(__dirname, 'seeds', 'benchmarks.json');
  if (!fs.existsSync(filePath)) return;

  const benchmarksData: any[] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const b of benchmarksData) {
    const { initialQuotes, ...meta } = b;
    await prisma.benchmark.upsert({
      where: { code: meta.code as BenchmarkCode },
      update: {
        name: meta.name,
        shortName: meta.shortName,
        returnType: meta.returnType as BenchmarkReturnType,
        exchange: meta.exchange,
        provider: meta.provider,
        description: meta.description,
        methodologyLabel: meta.methodologyLabel,
        isDefault: meta.isDefault ?? false,
      },
      create: {
        code: meta.code as BenchmarkCode,
        name: meta.name,
        shortName: meta.shortName,
        returnType: meta.returnType as BenchmarkReturnType,
        exchange: meta.exchange,
        provider: meta.provider,
        description: meta.description,
        methodologyLabel: meta.methodologyLabel,
        isDefault: meta.isDefault ?? false,
      },
    });

    if (Array.isArray(initialQuotes)) {
      for (const q of initialQuotes) {
        await prisma.indicesDataRecord.upsert({
          where: {
            date_indexCode: {
              date: q.date,
              indexCode: meta.code as BenchmarkCode,
            },
          },
          update: {
            closingValue: q.closingValue,
            notes: q.notes,
          },
          create: {
            date: q.date,
            indexCode: meta.code as BenchmarkCode,
            closingValue: q.closingValue,
            notes: q.notes,
            source: 'FEED',
            updatedBy: 'System Seed',
          },
        });
      }
    }
  }
  console.log(`[Seed] Seeded ${benchmarksData.length} benchmark index records and historical quotes.`);
}

async function seedHybridRules() {
  const filePath = path.join(__dirname, 'seeds', 'hybrid-rules.json');
  if (!fs.existsSync(filePath)) return;

  const rulesData: any[] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const r of rulesData) {
    await prisma.hybridAllocationRule.upsert({
      where: { schemeName: r.schemeName },
      update: {
        category: r.category as AssetCategory,
        equityRatio: r.equityRatio,
        debtRatio: r.debtRatio,
        isCustom: r.isCustom ?? false,
        notes: r.notes,
        updatedBy: r.updatedBy || 'Manager',
      },
      create: {
        id: r.id,
        schemeName: r.schemeName,
        category: r.category as AssetCategory,
        equityRatio: r.equityRatio,
        debtRatio: r.debtRatio,
        isCustom: r.isCustom ?? false,
        notes: r.notes,
        updatedBy: r.updatedBy || 'Manager',
      },
    });
  }
  console.log(`[Seed] Seeded ${rulesData.length} hybrid allocation rules.`);
}

async function seedSampleCashflowsAndBalances() {
  // Check if cashflows already exist
  const count = await prisma.masterCashflow.count();
  if (count > 0) {
    console.log(`[Seed] Master cashflows already seeded (${count} records). Skipping.`);
    return;
  }

  const staffUser = await prisma.user.findFirst({
    where: { role: 'staff_entry' },
  });

  if (!staffUser) return;

  const groupHeads = await prisma.groupHead.findMany({
    include: { familyMembers: true },
  });

  if (groupHeads.length === 0) return;

  const MF_FUNDS = [
    'Nippon India Multi Cap Fund - Growth',
    'Edelweiss Small Cap Fund - Regular Plan - Growth',
    'HSBC Small Cap Fund - Growth',
    'Helios Small Cap Fund - Growth',
    'TRUSTMF Small Cap Fund - Growth',
    'Union Small Cap Fund - Growth',
  ];

  // Seed 45 Initial Cashflows
  for (let i = 1; i <= 45; i++) {
    const head = groupHeads[(i - 1) % groupHeads.length];
    const family = head.familyMembers[(i - 1) % head.familyMembers.length];
    const isMf = i % 5 !== 0;
    const txnDay = String(((i - 1) % 27) + 1).padStart(2, '0');
    const txnMonth = i % 2 === 0 ? '09' : '08';
    const txnDate = `${txnDay}-${txnMonth}-2026`;
    const entryDate = `${txnDay}-${txnMonth}-2026`;
    const month = txnMonth === '09' ? 'September 2026' : 'August 2026';
    const amounts = Math.round(25000 + ((i - 1) % 17) * 18750);
    const newInv = i % 7 === 0 ? 0 : Math.round(amounts * 0.82);
    const pl = Math.round(amounts * (i % 3 === 0 ? -0.04 : 0.06));
    const xirr = Number((4 + ((i - 1) % 11) * 1.35).toFixed(2));

    const status =
      i % 9 === 0
        ? ApprovalStatus.APPROVED
        : i % 11 === 0
          ? ApprovalStatus.RETURNED
          : ApprovalStatus.PENDING;

    const cf = await prisma.masterCashflow.create({
      data: {
        srNo: i,
        dateOfEntry: entryDate,
        userId: staffUser.id,
        month,
        clientOwner: 'Anil K. (Wealth Advisor)',
        groupHeadId: head.id,
        groupHeadName: head.name,
        familyMemberId: family?.id ?? null,
        familyMemberName: family?.name ?? head.name,
        transactionDate: txnDate,
        transactionType: i % 4 === 0 ? TransactionType.REDEMPTION : TransactionType.PURCHASE,
        category: isMf ? AssetCategory.MF : AssetCategory.PMS,
        subCategory: isMf ? MF_FUNDS[(i - 1) % MF_FUNDS.length] : 'STALLION CORE FUND',
        amounts,
        newInvestments: newInv,
        profitLoss: pl,
        xirr,
        approvalStatus: status,
        returnReason:
          status === ApprovalStatus.RETURNED
            ? 'Reported trade diverges from custodian contract note — verify execution NAV'
            : null,
        submittedById: staffUser.id,
        submittedByName: staffUser.name,
        submittedAt: new Date(),
        approvedByName: status === ApprovalStatus.APPROVED ? 'Priya S. (Manager)' : null,
        approvedAt: status === ApprovalStatus.APPROVED ? new Date() : null,
      },
    });

    // Create initial audit entry
    await prisma.auditTrail.create({
      data: {
        action: AuditAction.CREATED,
        userId: staffUser.id,
        userName: staffUser.name,
        reason: 'Initial staff trade entry.',
        cashflowId: cf.id,
      },
    });
  }

  // Seed Initial Closing Balances for September 2026
  let cbSr = 1;
  for (const head of groupHeads) {
    for (const mem of head.familyMembers) {
      for (const cat of [AssetCategory.MF, AssetCategory.PMS]) {
        const sub = cat === AssetCategory.MF ? MF_FUNDS[0] : 'STALLION CORE FUND';
        const isMissing = cbSr % 9 === 0;

        await prisma.closingBalance.upsert({
          where: {
            monthKey_groupHeadId_familyMemberName_category_subCategory: {
              monthKey: '2026-09',
              groupHeadId: head.id,
              familyMemberName: mem.name,
              category: cat,
              subCategory: sub,
            },
          },
          update: {},
          create: {
            srNo: cbSr++,
            dateOfEntry: '30-09-2026',
            userId: staffUser.id,
            monthKey: '2026-09',
            month: 'September 2026',
            groupHeadId: head.id,
            groupHeadName: head.name,
            familyMemberId: mem.id,
            familyMemberName: mem.name,
            category: cat,
            subCategory: sub,
            closingAmount: isMissing ? null : Math.round(50000 + (cbSr % 19) * 12000),
            approvalStatus: ApprovalStatus.PENDING,
            submittedById: staffUser.id,
            submittedByName: staffUser.name,
          },
        });
      }
    }
  }

  console.log(`[Seed] Seeded initial 45 cashflow transactions and September 2026 closing balances.`);
}

async function main() {
  const seedFilePath = path.join(__dirname, 'seeds', 'users.json');
  console.log(`[Seed] Reading seed data from ${seedFilePath}...`);

  if (!fs.existsSync(seedFilePath)) {
    throw new Error(`Seed file not found at ${seedFilePath}`);
  }

  const fileContent = fs.readFileSync(seedFilePath, 'utf8');
  const rawUsers: unknown = JSON.parse(fileContent);

  if (!Array.isArray(rawUsers) || rawUsers.length === 0) {
    throw new Error('Seed file must contain an array of user objects');
  }

  const validatedUsers: SeedUserDto[] = rawUsers.map((user, idx) =>
    validateSeedUser(user, idx),
  );

  console.log(`[Seed] Schema validation passed for all ${validatedUsers.length} user record(s).`);

  for (const user of validatedUsers) {
    await seedUser(user);
  }
  console.log(`[Seed] Successfully processed ${validatedUsers.length} user(s) from JSON.`);

  // 1. Seed Group Heads & Family Members
  await seedGroupHeads();

  // 2. Seed Benchmarks & Historical Quotes
  await seedBenchmarks();

  // 3. Seed Hybrid Allocation Rules
  await seedHybridRules();

  // 4. Seed Initial Master Cashflows and Closing Balances
  await seedSampleCashflowsAndBalances();

  console.log('[Seed] All database seed steps completed successfully! 🚀');
}

main()
  .catch((err) => {
    console.error('[Seed] Error during seeding:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
