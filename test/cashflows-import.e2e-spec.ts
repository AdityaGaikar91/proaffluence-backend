import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';

import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { auth } from '../src/auth/auth';
import { prisma } from '../src/core/prisma/prisma.service';
import { AuditAction, ApprovalStatus } from '@prisma/client';

describe('Master Cashflows Batch Import (e2e)', () => {
  let app: INestApplication;
  let managerCookie: string;
  let staffCookie: string;
  let registeredGroupHeadName: string;

  const seedUsers = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../prisma/seeds/users.json'), 'utf8'),
  );
  const managerUser =
    seedUsers.find((u: any) => u.role === 'manager') || seedUsers[0];
  const staffUser =
    seedUsers.find((u: any) => u.role === 'staff_entry') || seedUsers[3];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });

    app.use(cookieParser());
    const authHandler = toNodeHandler(auth);
    app.use('/api/auth', (req, res, next) => {
      if (
        req.path === '/me' ||
        req.path.startsWith('/me?') ||
        req.path === '/forgot-password' ||
        req.path === '/reset-password' ||
        req.path.startsWith('/forgot-password?') ||
        req.path.startsWith('/reset-password?')
      ) {
        return next();
      }
      return authHandler(req, res);
    });

    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();

    // Authenticate manager
    const signInRes = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({
        email: managerUser.email,
        password: managerUser.password,
      });

    const setCookies = signInRes.headers['set-cookie'];
    if (Array.isArray(setCookies)) {
      managerCookie = setCookies.join('; ');
    } else if (setCookies) {
      managerCookie = setCookies;
    }

    // Authenticate staff_entry
    const staffRes = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({
        email: staffUser.email,
        password: staffUser.password,
      });

    const staffCookies = staffRes.headers['set-cookie'];
    if (Array.isArray(staffCookies)) {
      staffCookie = staffCookies.join('; ');
    } else if (staffCookies) {
      staffCookie = staffCookies;
    }

    // Lookup a registered Group Head
    const gh = await prisma.groupHead.findFirst();
    if (!gh) {
      throw new Error('No GroupHead found in database. Run seed first.');
    }
    registeredGroupHeadName = gh.name;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/cashflows/import', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/cashflows/import')
        .send({ rows: [] })
        .expect(401);
    });

    it('should reject empty rows array with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/cashflows/import')
        .set('Cookie', staffCookie)
        .send({ rows: [] })
        .expect(400);
    });

    it('should reject batch with non-existent Group Head with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cashflows/import')
        .set('Cookie', staffCookie)
        .send({
          rows: [
            {
              Group_Head_Name: 'NonExistentMandateXYZZZ_999',
              Family_Member_Name: 'Sample Member',
              Transaction_Date: '15-05-2025',
              Transaction_Type: 'Purchase',
              Category: 'MF',
              Sub_Category: 'Large Cap Fund',
              Amounts: 50000,
            },
          ],
        })
        .expect(400);

      expect(res.body.message).toContain('not found in registered directory');
    });

    it('should successfully batch import multiple rows with sequential Sr_No and AuditAction.IMPORTED', async () => {
      const uniqueFamilyMember = `ImportTestMember_${Date.now()}`;

      const importPayload = {
        rows: [
          {
            Group_Head_Name: registeredGroupHeadName,
            Family_Member_Name: uniqueFamilyMember,
            Transaction_Date: '10-06-2025',
            Transaction_Type: 'Purchase',
            Category: 'STOCK', // tests normalizer STOCK -> STOCKS
            Sub_Category: 'Tata Motors',
            Amounts: 75000,
            New_Investments: 75000,
            Profit_Loss: 0,
            XIRR: 0,
          },
          {
            Group_Head_Name: registeredGroupHeadName,
            Family_Member_Name: uniqueFamilyMember,
            Transaction_Date: '12-06-2025',
            Transaction_Type: 'Redemption',
            Category: 'MF',
            Sub_Category: 'HDFC Top 100',
            Amounts: 25000,
            New_Investments: 0,
            Profit_Loss: 5000,
            XIRR: 14.2,
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/cashflows/import')
        .set('Cookie', staffCookie)
        .send(importPayload)
        .expect(201);

      expect(res.body).toHaveProperty('count', 2);
      expect(res.body).toHaveProperty('importedIds');
      expect(res.body.importedIds).toHaveLength(2);
      expect(res.body).toHaveProperty('srNoRange');
      expect(res.body.srNoRange.end - res.body.srNoRange.start + 1).toBe(2);

      const [id1, id2] = res.body.importedIds;

      // Verify DB persistence of imported entities
      const record1 = await prisma.masterCashflow.findUnique({
        where: { id: id1 },
      });
      const record2 = await prisma.masterCashflow.findUnique({
        where: { id: id2 },
      });

      expect(record1).toBeDefined();
      expect(record2).toBeDefined();
      expect(record1?.approvalStatus).toBe(ApprovalStatus.PENDING);
      expect(record1?.category).toBe('STOCKS'); // Verified STOCK -> STOCKS mapping
      expect(record2?.category).toBe('MF');
      expect(Number(record1?.amounts)).toBe(75000);
      expect(Number(record2?.amounts)).toBe(25000);
      expect(record2?.srNo).toBe(record1!.srNo + 1);

      // Verify Audit Trail records
      const audits1 = await prisma.auditTrail.findMany({
        where: { cashflowId: id1 },
      });
      expect(audits1).toHaveLength(1);
      expect(audits1[0].action).toBe(AuditAction.IMPORTED);
      expect(audits1[0].reason).toContain('Bulk broker trade import');

      const audits2 = await prisma.auditTrail.findMany({
        where: { cashflowId: id2 },
      });
      expect(audits2).toHaveLength(1);
      expect(audits2[0].action).toBe(AuditAction.IMPORTED);

      // Verify on-demand family member was created
      const createdMember = await prisma.familyMember.findFirst({
        where: { name: uniqueFamilyMember },
      });
      expect(createdMember).toBeDefined();

      // Clean up test records
      await prisma.auditTrail.deleteMany({
        where: { cashflowId: { in: [id1, id2] } },
      });
      await prisma.masterCashflow.deleteMany({
        where: { id: { in: [id1, id2] } },
      });
      if (createdMember) {
        await prisma.familyMember.delete({ where: { id: createdMember.id } });
      }
    });

    it('should reject import with 409 Conflict if any month in batch is frozen', async () => {
      const frozenPeriod = '2027-02';
      // Create or ensure frozen reporting run
      const run = await prisma.reportingRun.upsert({
        where: { period: frozenPeriod },
        create: {
          period: frozenPeriod,
          monthKey: frozenPeriod,
          isFrozen: true,
          frozenAt: new Date(),
        },
        update: {
          isFrozen: true,
          frozenAt: new Date(),
        },
      });

      try {
        const res = await request(app.getHttpServer())
          .post('/api/v1/cashflows/import')
          .set('Cookie', staffCookie)
          .send({
            rows: [
              {
                Group_Head_Name: registeredGroupHeadName,
                Family_Member_Name: 'Any Member',
                Transaction_Date: '15-02-2027', // falls in 2027-02
                Transaction_Type: 'Purchase',
                Category: 'MF',
                Sub_Category: 'Axis Bluechip',
                Amounts: 10000,
              },
            ],
          })
          .expect(409);

        expect(res.body.message).toContain('frozen');
      } finally {
        await prisma.reportingRun.delete({ where: { id: run.id } });
      }
    });
  });
});
