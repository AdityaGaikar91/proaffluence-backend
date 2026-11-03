/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
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

describe('Monthly Closing Balances (e2e)', () => {
  let app: INestApplication;
  let managerCookie: string;
  let staffCookie: string;

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

    app.use(express.json({ limit: '100kb' }));
    app.use(express.urlencoded({ extended: true, limit: '100kb' }));

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();

    // Authenticate as manager
    const mgrRes = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({
        email: managerUser.email,
        password: managerUser.password,
      });

    const mgrCookies = mgrRes.headers['set-cookie'];
    if (Array.isArray(mgrCookies)) {
      managerCookie = mgrCookies.join('; ');
    } else if (mgrCookies) {
      managerCookie = mgrCookies;
    }

    // Authenticate as staff_entry
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
  });

  afterAll(async () => {
    // Clean up any test month scaffolded or created during test
    await prisma.auditTrail.deleteMany({
      where: {
        balance: {
          monthKey: { in: ['2026-11', '2026-12', '2026-10'] },
        },
      },
    });
    await prisma.closingBalance.deleteMany({
      where: { monthKey: { in: ['2026-11', '2026-12', '2026-10'] } },
    });
    await app.close();
  });

  describe('Bug 1: Staff cannot approve and return (RBAC)', () => {
    let sampleRecordId: string;

    beforeAll(async () => {
      const rec = await prisma.closingBalance.findFirst({
        where: { monthKey: '2026-09' },
      });
      sampleRecordId = rec!.id;
    });

    it('should return 403 when staff_entry tries to approve a single record', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/closing-balances/${sampleRecordId}/approve`)
        .set('Cookie', staffCookie)
        .expect(403);
    });

    it('should return 403 when staff_entry tries to return a single record', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/closing-balances/${sampleRecordId}/return`)
        .set('Cookie', staffCookie)
        .send({ reason: 'Unauthorized staff return' })
        .expect(403);
    });

    it('should return 403 when staff_entry tries to bulk-approve', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/closing-balances/bulk-approve')
        .set('Cookie', staffCookie)
        .send({ ids: [sampleRecordId] })
        .expect(403);
    });

    it('should return 403 when staff_entry tries to bulk-return', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/closing-balances/bulk-return')
        .set('Cookie', staffCookie)
        .send({ ids: [sampleRecordId], reason: 'Staff batch return' })
        .expect(403);
    });

    it('should return 403 when staff_entry tries to approve-month', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/closing-balances/approve-month')
        .set('Cookie', staffCookie)
        .send({ monthKey: '2026-09' })
        .expect(403);
    });
  });

  describe('Bug 2: Rows with no closing amount cannot be approved', () => {
    let unvaluedRecordId: string;

    beforeAll(async () => {
      // Find or create an unvalued record (closingAmount: null) and ensure it is PENDING
      let unvalued = await prisma.closingBalance.findFirst({
        where: { monthKey: '2026-09', closingAmount: null },
      });
      if (!unvalued) {
        unvalued = await prisma.closingBalance.findFirst({
          where: { monthKey: '2026-09' },
        });
      }
      await prisma.closingBalance.update({
        where: { id: unvalued!.id },
        data: {
          closingAmount: null,
          approvalStatus: 'PENDING',
          approvedById: null,
          approvedByName: null,
          approvedAt: null,
        },
      });
      unvaluedRecordId = unvalued!.id;
    });

    it('should reject single approve on record with null closing amount with 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/closing-balances/${unvaluedRecordId}/approve`)
        .set('Cookie', managerCookie)
        .expect(400);

      expect(res.body.message).toContain('no closing amount');
    });

    it('bulkApprove should skip rows with null closing amount and not approve them', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/closing-balances/bulk-approve')
        .set('Cookie', managerCookie)
        .send({ ids: [unvaluedRecordId] })
        .expect(200);

      expect(res.body.approvedCount).toBe(0);

      const check = await prisma.closingBalance.findUnique({
        where: { id: unvaluedRecordId },
      });
      expect(check?.approvalStatus).toBe('PENDING');
    });
  });

  describe('Bug 3: Bulk approve and return handle invalid, duplicate, and non-existent IDs without 500', () => {
    it('bulkApprove handles duplicate, non-existent, and invalid IDs safely', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app.getHttpServer())
        .post('/api/v1/closing-balances/bulk-approve')
        .set('Cookie', managerCookie)
        .send({ ids: [nonExistentId, nonExistentId] })
        .expect(200);

      expect(res.body.approvedCount).toBe(0);

      // Verify no orphan audit records were created
      const audits = await prisma.auditTrail.findMany({
        where: { balanceId: nonExistentId },
      });
      expect(audits.length).toBe(0);
    });

    it('bulkReturn handles non-existent IDs safely', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app.getHttpServer())
        .post('/api/v1/closing-balances/bulk-return')
        .set('Cookie', managerCookie)
        .send({ ids: [nonExistentId], reason: 'Batch return test' })
        .expect(200);

      expect(res.body.returnedCount).toBe(0);
    });
  });

  describe('Bug 4: Approved rows cannot be re-approved, returned, or silently keep old approval metadata', () => {
    let testRecordId: string;

    beforeAll(async () => {
      // Find an entry, set valuation, and approve it
      const rec = await prisma.closingBalance.findFirst({
        where: { monthKey: '2026-09' },
      });
      testRecordId = rec!.id;

      await prisma.closingBalance.update({
        where: { id: testRecordId },
        data: {
          closingAmount: 150000,
          approvalStatus: 'PENDING',
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/closing-balances/${testRecordId}/approve`)
        .set('Cookie', managerCookie)
        .expect(200);
    });

    it('re-approving an already approved row throws 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/closing-balances/${testRecordId}/approve`)
        .set('Cookie', managerCookie)
        .expect(400);

      expect(res.body.message).toContain('already approved');
    });

    it('returning an already approved row throws 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/closing-balances/${testRecordId}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: 'Attempt to return approved entry' })
        .expect(400);

      expect(res.body.message).toContain('already approved');
    });

    it('bulkReturn ignores approved rows and returns 0 count', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/closing-balances/bulk-return')
        .set('Cookie', managerCookie)
        .send({ ids: [testRecordId], reason: 'Bulk return test' })
        .expect(200);

      expect(res.body.returnedCount).toBe(0);

      const check = await prisma.closingBalance.findUnique({
        where: { id: testRecordId },
      });
      expect(check?.approvalStatus).toBe('APPROVED');
    });

    it('PATCH /batch on an approved row resets it to PENDING and clears approvedById/approvedAt', async () => {
      // Record is currently APPROVED
      const before = await prisma.closingBalance.findUnique({
        where: { id: testRecordId },
      });
      expect(before?.approvalStatus).toBe('APPROVED');
      expect(before?.approvedById).not.toBeNull();

      // Edit amount
      await request(app.getHttpServer())
        .patch('/api/v1/closing-balances/batch')
        .set('Cookie', managerCookie)
        .send({ updates: { [testRecordId]: 175000 } })
        .expect(200);

      const after = await prisma.closingBalance.findUnique({
        where: { id: testRecordId },
      });
      expect(after?.approvalStatus).toBe('PENDING');
      expect(after?.approvedById).toBeNull();
      expect(after?.approvedByName).toBeNull();
      expect(after?.approvedAt).toBeNull();
      expect(Number(after?.closingAmount)).toBe(175000);
    });
  });

  describe('Bug 5: PATCH /batch rejects bad values with 400', () => {
    let sampleId: string;

    beforeAll(async () => {
      const rec = await prisma.closingBalance.findFirst({
        where: { monthKey: '2026-09' },
      });
      sampleId = rec!.id;
    });

    it('rejects negative numbers with 400', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/closing-balances/batch')
        .set('Cookie', managerCookie)
        .send({ updates: { [sampleId]: -500 } })
        .expect(400);

      expect(res.body.message).toContain('cannot be negative');
    });

    it('rejects boolean values with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/closing-balances/batch')
        .set('Cookie', managerCookie)
        .send({ updates: { [sampleId]: true } })
        .expect(400);
    });

    it('rejects string values like "abc" with 400', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/closing-balances/batch')
        .set('Cookie', managerCookie)
        .send({ updates: { [sampleId]: 'abc' } })
        .expect(400);
    });

    it('rejects overflow numbers like 1e20 with 400 instead of 500', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/closing-balances/batch')
        .set('Cookie', managerCookie)
        .send({ updates: { [sampleId]: 1e20 } })
        .expect(400);

      expect(res.body.message).toContain('exceeds maximum allowable limit');
    });
  });

  describe('Bug 6: POST / validation and duplicate handling', () => {
    it('returns 400 for whitespace-only Group_Head_Name', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/closing-balances')
        .set('Cookie', managerCookie)
        .send({
          Date_Of_Entry: '31-10-2026',
          Group_Head_Name: '   ',
          Family_Member_Name: 'Valid Member',
          Category: 'MF',
          Sub_Category: 'Growth Fund',
        })
        .expect(400);
    });

    it('returns 400 for impossible dates like 31-02-2098', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/closing-balances')
        .set('Cookie', managerCookie)
        .send({
          Date_Of_Entry: '31-02-2098',
          Group_Head_Name: 'Desai Group',
          Family_Member_Name: 'Family Member',
          Category: 'MF',
          Sub_Category: 'Growth Fund',
        })
        .expect(400);

      expect(res.body.message).toContain('valid calendar date');
    });

    it('allows staff explicit monthKey that differs from Date_Of_Entry (historical backfill)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/closing-balances')
        .set('Cookie', staffCookie)
        .send({
          Date_Of_Entry: '15-10-2026',
          monthKey: '2026-05',
          Group_Head_Name: 'Desai Group',
          Family_Member_Name: 'Backdate Test Member',
          Category: 'MF',
          Sub_Category: 'Backdate Test Fund',
          Closing_Amount: 1000,
        })
        .expect(201);

      expect(res.body.monthKey).toBe('2026-05');
      expect(res.body.dateOfEntry).toBe('15-10-2026');
    });

    it('returns 400 for negative Closing_Amount', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/closing-balances')
        .set('Cookie', managerCookie)
        .send({
          Date_Of_Entry: '31-10-2026',
          Group_Head_Name: 'Desai Group',
          Family_Member_Name: 'Family Member',
          Category: 'MF',
          Sub_Category: 'Growth Fund',
          Closing_Amount: -5000,
        })
        .expect(400);
    });

    it('returns 409 Conflict for duplicate mandate entry instead of 500', async () => {
      // First insert
      await request(app.getHttpServer())
        .post('/api/v1/closing-balances')
        .set('Cookie', managerCookie)
        .send({
          Date_Of_Entry: '31-10-2026',
          monthKey: '2026-10',
          Group_Head_Name: 'Desai Group',
          Family_Member_Name: 'Duplicate Test Member',
          Category: 'MF',
          Sub_Category: 'Duplicate Test Fund',
          Closing_Amount: 100000,
        })
        .expect(201);

      // Second duplicate insert must return 409
      const dupRes = await request(app.getHttpServer())
        .post('/api/v1/closing-balances')
        .set('Cookie', managerCookie)
        .send({
          Date_Of_Entry: '31-10-2026',
          monthKey: '2026-10',
          Group_Head_Name: 'Desai Group',
          Family_Member_Name: 'Duplicate Test Member',
          Category: 'MF',
          Sub_Category: 'Duplicate Test Fund',
          Closing_Amount: 200000,
        })
        .expect(409);

      expect(dupRes.body.message).toContain('already exists');
    });
  });

  describe('Bug 7: Invalid month formats rejected', () => {
    it('POST /initialize-month rejects month 13 (2098-13) with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/closing-balances/initialize-month')
        .set('Cookie', managerCookie)
        .send({ monthKey: '2098-13' })
        .expect(400);
    });

    it('GET /summary?monthKey=garbage returns 400', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/closing-balances/summary?monthKey=garbage')
        .set('Cookie', managerCookie)
        .expect(400);
    });
  });

  describe('Bug 8: Smaller issues (whitespace reasons, category filter, % wildcard)', () => {
    let testRecordId: string;

    beforeAll(async () => {
      const rec = await prisma.closingBalance.findFirst({
        where: { monthKey: '2026-09' },
      });
      testRecordId = rec!.id;
    });

    it('POST /:id/return rejects whitespace-only return reason with 400', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/closing-balances/${testRecordId}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: '   ' })
        .expect(400);
    });

    it('POST /bulk-return rejects whitespace-only reason with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/closing-balances/bulk-return')
        .set('Cookie', managerCookie)
        .send({ ids: [testRecordId], reason: '   ' })
        .expect(400);
    });

    it('filtering by unknown category returns 0 rows instead of every row', async () => {
      const res = await request(app.getHttpServer())
        .get(
          '/api/v1/closing-balances?monthKey=2026-09&category=NON_EXISTENT_CAT',
        )
        .set('Cookie', managerCookie)
        .expect(200);

      expect(res.body.data.length).toBe(0);
      expect(res.body.meta.total).toBe(0);
    });

    it('searching for % matches 0 rows instead of every row', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/closing-balances?monthKey=2026-09&search=%25')
        .set('Cookie', managerCookie)
        .expect(200);

      expect(res.body.data.length).toBe(0);
      expect(res.body.meta.total).toBe(0);
    });
  });

  describe('Standard Happy Paths: List, Summary, Initialize, and Gate Override', () => {
    it('GET / returns paginated rows for 2026-09', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/closing-balances?monthKey=2026-09&page=1&limit=10')
        .set('Cookie', managerCookie)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.counts.all).toBeGreaterThan(0);
    });

    it('POST /initialize-month creates rows for 2026-11', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/closing-balances/initialize-month')
        .set('Cookie', managerCookie)
        .send({ monthKey: '2026-11' })
        .expect(200);

      expect(res.body.scaffoldedCount).toBeGreaterThan(0);
    });

    it('POST /approve-month rejects without override when missing valuations exist', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/closing-balances/approve-month')
        .set('Cookie', managerCookie)
        .send({ monthKey: '2026-11', allowMissingOverride: false })
        .expect(400);

      expect(res.body.message).toContain('valuation(s) are missing');
    });

    it('POST /approve-month succeeds with override and justification', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/closing-balances/approve-month')
        .set('Cookie', managerCookie)
        .send({
          monthKey: '2026-11',
          allowMissingOverride: true,
          overrideReason: 'Approved by senior manager for testing audit trail',
        })
        .expect(200);

      expect(res.body.overridden).toBe(true);
    });
  });
});
