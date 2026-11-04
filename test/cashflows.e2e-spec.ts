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

describe('Master Cashflows (e2e)', () => {
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
    await app.close();
  });

  describe('GET /api/v1/cashflows', () => {
    it('should return 200 when querying with category=All', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cashflows?page=1&limit=10&category=All')
        .set('Cookie', managerCookie)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(res.body).toHaveProperty('counts');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta.limit).toBe(10);
      expect(res.body.meta.page).toBe(1);
    });

    it('should return 200 and filter by specific category (e.g. MF)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cashflows?page=1&limit=10&category=MF')
        .set('Cookie', managerCookie)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      res.body.data.forEach((item: any) => {
        expect(item.category).toBe('MF');
      });
    });

    it('should return 200 when filtering by statusTab', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cashflows?page=1&limit=10&statusTab=PENDING')
        .set('Cookie', managerCookie)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      res.body.data.forEach((item: any) => {
        expect(item.approvalStatus).toBe('PENDING');
      });
    });

    it('should return records in ascending srNo order by default', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cashflows?page=1&limit=10')
        .set('Cookie', managerCookie)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(1);
      expect(res.body.data[0].srNo).toBeLessThan(res.body.data[1].srNo);
      expect(res.body.data[0].srNo).toBe(1);
    });
  });

  describe('RBAC Guard Enforcement on Cashflows', () => {
    let samplePendingId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/cashflows?statusTab=PENDING&limit=1')
        .set('Cookie', managerCookie);
      if (res.body.data?.length > 0) {
        samplePendingId = res.body.data[0].id;
      }
    });

    it('should return 403 Forbidden when staff_entry tries to approve a cashflow', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/cashflows/${samplePendingId}/approve`)
        .set('Cookie', staffCookie)
        .expect(403);
    });

    it('should return 403 Forbidden when staff_entry tries to return a cashflow', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/cashflows/${samplePendingId}/return`)
        .set('Cookie', staffCookie)
        .send({ reason: 'Unauthorized staff rejection attempt' })
        .expect(403);
    });

    it('should return 403 Forbidden when staff_entry tries to bulk-approve cashflows', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/cashflows/bulk-approve')
        .set('Cookie', staffCookie)
        .send({ ids: [samplePendingId] })
        .expect(403);
    });

    it('should return 403 Forbidden when staff_entry tries to bulk-return cashflows', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/cashflows/bulk-return')
        .set('Cookie', staffCookie)
        .send({ ids: [samplePendingId], reason: 'Unauthorized staff batch return' })
        .expect(403);
    });

    it('should return 403 Forbidden when staff_entry tries to void a cashflow', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/cashflows/${samplePendingId}/void`)
        .set('Cookie', staffCookie)
        .send({ reason: 'Unauthorized staff void' })
        .expect(403);
    });
  });

  describe('Maker-Checker Workflow (Creation, Approval, Return & Integrity)', () => {
    let createdEntryId: string;

    it('should allow staff_entry to create a trade entry queued as PENDING', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cashflows')
        .set('Cookie', staffCookie)
        .send({
          Date_Of_Entry: '15-10-2026',
          User_Id: 'ABCDE1234F',
          Client_Owner: 'Aditi Sharma',
          Group_Head_Name: 'Desai Group',
          Family_Member_Name: 'Aarti Desai',
          Transaction_Date: '15-10-2026',
          Transaction_Type: 'Purchase',
          Category: 'MF',
          Sub_Category: 'EQUITY',
          Amounts: 250000,
          New_Investments: 250000,
          Profit_Loss: 0,
          XIRR: 0,
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      createdEntryId = res.body.id;
      expect(res.body.approvalStatus).toBe('PENDING');
      expect(res.body.submittedById).toBeDefined();
      expect(res.body.submittedByName).toBe(staffUser.name);

      // Verify audit log
      const auditRes = await request(app.getHttpServer())
        .get(`/api/v1/cashflows/${createdEntryId}`)
        .set('Cookie', managerCookie)
        .expect(200);

      expect(auditRes.body.auditEntries.length).toBeGreaterThanOrEqual(1);
      expect(auditRes.body.auditEntries[0].action).toBe('CREATED');
    });

    it('should allow manager to approve the pending trade entry', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashflows/${createdEntryId}/approve`)
        .set('Cookie', managerCookie)
        .expect(200);

      expect(res.body.approvalStatus).toBe('APPROVED');
      expect(res.body.approvedById).toBeDefined();
      expect(res.body.approvedByName).toBe(managerUser.name);
      expect(res.body.approvedAt).toBeDefined();

      // Verify audit trail record
      const auditRes = await request(app.getHttpServer())
        .get(`/api/v1/cashflows/${createdEntryId}`)
        .set('Cookie', managerCookie)
        .expect(200);

      const latestAudit = auditRes.body.auditEntries[0];
      expect(latestAudit.action).toBe('APPROVED');
      expect(latestAudit.userId).toBe(res.body.approvedById);
    });

    it('should reject double approval of an already approved trade entry with 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashflows/${createdEntryId}/approve`)
        .set('Cookie', managerCookie)
        .expect(400);

      expect(res.body.message).toContain('already approved');
    });

    it('should reject returning an already approved trade entry with 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/cashflows/${createdEntryId}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: 'Invalid attempt to return an approved trade' })
        .expect(400);

      expect(res.body.message).toContain('Cannot return an already approved');
    });

    it('should allow manager to return a pending trade entry with reason', async () => {
      // Create a second entry for return testing
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/cashflows')
        .set('Cookie', staffCookie)
        .send({
          Date_Of_Entry: '16-10-2026',
          User_Id: 'ABCDE1234F',
          Client_Owner: 'Aditi Sharma',
          Group_Head_Name: 'Desai Group',
          Family_Member_Name: 'Aarti Desai',
          Transaction_Date: '16-10-2026',
          Transaction_Type: 'Purchase',
          Category: 'PMS',
          Sub_Category: 'DEBT',
          Amounts: 100000,
          New_Investments: 100000,
          Profit_Loss: 0,
          XIRR: 0,
        })
        .expect(201);

      const returnTargetId = createRes.body.id;

      // Reject empty reason
      await request(app.getHttpServer())
        .post(`/api/v1/cashflows/${returnTargetId}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: '   ' })
        .expect(400);

      // Return with valid reason
      const returnRes = await request(app.getHttpServer())
        .post(`/api/v1/cashflows/${returnTargetId}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: 'Reported amount does not match statement. Please re-verify.' })
        .expect(200);

      expect(returnRes.body.approvalStatus).toBe('RETURNED');
      expect(returnRes.body.returnReason).toBe('Reported amount does not match statement. Please re-verify.');

      // Check audit log
      const auditRes = await request(app.getHttpServer())
        .get(`/api/v1/cashflows/${returnTargetId}`)
        .set('Cookie', managerCookie)
        .expect(200);

      const latestAudit = auditRes.body.auditEntries[0];
      expect(latestAudit.action).toBe('RETURNED');
      expect(latestAudit.reason).toContain('Reported amount does not match');
    });
  });

  describe('Maker Correction Workflow', () => {
    it('should allow staff to correct a returned trade entry and re-queue it as PENDING', async () => {
      // Create and return an entry
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/cashflows')
        .set('Cookie', staffCookie)
        .send({
          Date_Of_Entry: '17-10-2026',
          User_Id: 'ABCDE1234F',
          Client_Owner: 'Aditi Sharma',
          Group_Head_Name: 'Desai Group',
          Family_Member_Name: 'Aarti Desai',
          Transaction_Date: '17-10-2026',
          Transaction_Type: 'Purchase',
          Category: 'MF',
          Sub_Category: 'HYBRID',
          Amounts: 50000,
          New_Investments: 50000,
          Profit_Loss: 0,
          XIRR: 0,
        })
        .expect(201);

      const entryId = createRes.body.id;

      // Return it
      await request(app.getHttpServer())
        .post(`/api/v1/cashflows/${entryId}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: 'Incorrect amount.' })
        .expect(200);

      // Staff corrects it
      const correctRes = await request(app.getHttpServer())
        .patch(`/api/v1/cashflows/${entryId}/correct`)
        .set('Cookie', staffCookie)
        .send({
          Amounts: 75000,
          New_Investments: 75000,
          correctionReason: 'Corrected amount per broker contract note.',
        })
        .expect(200);

      expect(correctRes.body.approvalStatus).toBe('PENDING');
      expect(Number(correctRes.body.amounts)).toBe(75000);
      expect(correctRes.body.approvedById).toBeNull();
      expect(correctRes.body.approvedByName).toBeNull();
      expect(correctRes.body.approvedAt).toBeNull();

      // Verify audit trail has diff
      const auditRes = await request(app.getHttpServer())
        .get(`/api/v1/cashflows/${entryId}`)
        .set('Cookie', managerCookie)
        .expect(200);

      const latestAudit = auditRes.body.auditEntries[0];
      expect(latestAudit.action).toBe('CORRECTED');
      expect(latestAudit.reason).toContain('broker contract note');
      expect(latestAudit.changes).toHaveProperty('Amounts');
    });
  });

  describe('Bulk Operations & Integrity Guards', () => {
    it('should bulk approve pending entries and skip already approved/non-existent IDs without 500', async () => {
      // Create 2 pending entries
      const e1 = await request(app.getHttpServer())
        .post('/api/v1/cashflows')
        .set('Cookie', staffCookie)
        .send({
          Date_Of_Entry: '18-10-2026',
          User_Id: 'ABCDE1234F',
          Client_Owner: 'Aditi Sharma',
          Group_Head_Name: 'Desai Group',
          Family_Member_Name: 'Aarti Desai',
          Transaction_Date: '18-10-2026',
          Transaction_Type: 'Purchase',
          Category: 'MF',
          Sub_Category: 'EQUITY',
          Amounts: 30000,
        })
        .expect(201);

      const e2 = await request(app.getHttpServer())
        .post('/api/v1/cashflows')
        .set('Cookie', staffCookie)
        .send({
          Date_Of_Entry: '18-10-2026',
          User_Id: 'ABCDE1234F',
          Client_Owner: 'Aditi Sharma',
          Group_Head_Name: 'Desai Group',
          Family_Member_Name: 'Aarti Desai',
          Transaction_Date: '18-10-2026',
          Transaction_Type: 'Purchase',
          Category: 'MF',
          Sub_Category: 'EQUITY',
          Amounts: 40000,
        })
        .expect(201);

      const fakeId = '00000000-0000-0000-0000-000000000000';

      // Bulk approve e1, e2, fakeId, and duplicate e1
      const bulkRes = await request(app.getHttpServer())
        .post('/api/v1/cashflows/bulk-approve')
        .set('Cookie', managerCookie)
        .send({ ids: [e1.body.id, e2.body.id, fakeId, e1.body.id] })
        .expect(200);

      expect(bulkRes.body.approvedCount).toBe(2);

      // Verify second attempt returns 0 approved count and doesn't throw
      const bulkRes2 = await request(app.getHttpServer())
        .post('/api/v1/cashflows/bulk-approve')
        .set('Cookie', managerCookie)
        .send({ ids: [e1.body.id, e2.body.id, fakeId] })
        .expect(200);

      expect(bulkRes2.body.approvedCount).toBe(0);
    });

    it('should bulk return pending entries with reason', async () => {
      // Create 2 pending entries
      const e1 = await request(app.getHttpServer())
        .post('/api/v1/cashflows')
        .set('Cookie', staffCookie)
        .send({
          Date_Of_Entry: '19-10-2026',
          User_Id: 'ABCDE1234F',
          Client_Owner: 'Aditi Sharma',
          Group_Head_Name: 'Desai Group',
          Family_Member_Name: 'Aarti Desai',
          Transaction_Date: '19-10-2026',
          Transaction_Type: 'Purchase',
          Category: 'MF',
          Sub_Category: 'EQUITY',
          Amounts: 60000,
        })
        .expect(201);

      const e2 = await request(app.getHttpServer())
        .post('/api/v1/cashflows')
        .set('Cookie', staffCookie)
        .send({
          Date_Of_Entry: '19-10-2026',
          User_Id: 'ABCDE1234F',
          Client_Owner: 'Aditi Sharma',
          Group_Head_Name: 'Desai Group',
          Family_Member_Name: 'Aarti Desai',
          Transaction_Date: '19-10-2026',
          Transaction_Type: 'Purchase',
          Category: 'MF',
          Sub_Category: 'EQUITY',
          Amounts: 70000,
        })
        .expect(201);

      const bulkRes = await request(app.getHttpServer())
        .post('/api/v1/cashflows/bulk-return')
        .set('Cookie', managerCookie)
        .send({
          ids: [e1.body.id, e2.body.id],
          reason: 'Batch return for CAS reconciliation.',
        })
        .expect(200);

      expect(bulkRes.body.returnedCount).toBe(2);
    });
  });
});
