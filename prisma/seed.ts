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
  @IsIn(['super_admin', 'staff_entry'], {
    message: 'Role must be either "super_admin" or "staff_entry"',
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
    // Idempotently update user details and role
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
    // Generate UUID v4 for the user and account
    const userId = crypto.randomUUID();
    const accountId = crypto.randomUUID();

    // Create new user with specified role and details
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

  // Schema-level validation for every entry before performing database writes
  const validatedUsers: SeedUserDto[] = rawUsers.map((user, idx) =>
    validateSeedUser(user, idx),
  );

  console.log(
    `[Seed] Schema validation passed for all ${validatedUsers.length} user record(s).`,
  );

  for (const user of validatedUsers) {
    await seedUser(user);
  }

  console.log(`[Seed] Successfully processed ${validatedUsers.length} user(s) from JSON.`);
}

main()
  .catch((err) => {
    console.error('[Seed] Error during seeding:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
