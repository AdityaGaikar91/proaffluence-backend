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

describe('Master Cashflows Auto Calculation (e2e)', () => {
  let app: INestApplication;
  let managerCookie: string;
  let staffCookie: string;
  let registeredGroupHeadName: string;
  let registeredGroupHeadId: string;
  const createdCashflowIds: string[] = [];

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
      throw new Error(
        'Database has no GroupHead records. Ensure seeds are run.',
      );
    }
    registeredGroupHeadName = gh.name;
    registeredGroupHeadId = gh.id;
  });

  afterAll(async () => {
    if (createdCashflowIds.length > 0) {
      await prisma.auditTrail.deleteMany({
        where: { cashflowId: { in: createdCashflowIds } },
      });
      await prisma.masterCashflow.deleteMany({
        where: { id: { in: createdCashflowIds } },
      });
    }
    await app.close();
  });

  describe('Single Entry Auto-Calculation (POST /api/v1/cashflows)', () => {
    const testSubCategory = `Autocalc Scheme ${Date.now()}`;

    it('should automatically calculate New_Investments for a PURCHASE when omitted', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cashflows')
        .set('Cookie', staffCookie)
        .send({
          Date_Of_Entry: '15-11-2026',
          Group_Head_Name: registeredGroupHeadName,
          Family_Member_Name: 'Test Beneficiary',
          Client_Owner: 'Test Advisor',
          Transaction_Date: '15-11-2026',
          Transaction_Type: 'Purchase',
          Category: 'MF',
          Sub_Category: testSubCategory,
          Amounts: 100000,
          // Intentionally omitting New_Investments, Profit_Loss, XIRR
        });

      expect(res.status).toBe(201);
      if (res.body.id) createdCashflowIds.push(res.body.id);
      expect(Number(res.body.newInvestments)).toBe(-100000);
      expect(Number(res.body.profitLoss)).toBe(0);
      expect(Number(res.body.xirr)).toBe(0);
    });

    it('should automatically calculate New_Investments, Profit_Loss, and XIRR for REDEMPTION against prior purchase', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/cashflows')
        .set('Cookie', staffCookie)
        .send({
          Date_Of_Entry: '20-11-2026',
          Group_Head_Name: registeredGroupHeadName,
          Family_Member_Name: 'Test Beneficiary',
          Client_Owner: 'Test Advisor',
          Transaction_Date: '20-11-2026',
          Transaction_Type: 'Redemption',
          Category: 'MF',
          Sub_Category: testSubCategory,
          Amounts: 100000,
          // Intentionally omitting New_Investments, Profit_Loss, XIRR
        });

      expect(res.status).toBe(201);
      if (res.body.id) createdCashflowIds.push(res.body.id);
      expect(Number(res.body.newInvestments)).toBe(100000);
      expect(Number(res.body.profitLoss)).toBe(0); // 100,000 redemption - 100,000 cost basis = 0
    });
  });

  describe('Batch Import Auto-Calculation (POST /api/v1/cashflows/import)', () => {
    it('should auto-populate derivative financial columns for rows with empty/omitted values', async () => {
      const uniqueSubCat = `Batch AutoCalc ${Date.now()}`;
      const payload = {
        rows: [
          {
            Transaction_Date: '01-11-2026',
            Transaction_Type: 'Purchase',
            Category: 'STOCK', // tests STOCK -> STOCKS mapping
            Sub_Category: uniqueSubCat,
            Group_Head_Name: registeredGroupHeadName,
            Family_Member_Name: 'Batch Member',
            Client_Owner: 'Advisor B',
            Amounts: 75000,
            // Omitting New_Investments, Profit_Loss, XIRR
          },
          {
            Transaction_Date: '10-11-2026',
            Transaction_Type: 'Redemption',
            Category: 'STOCK',
            Sub_Category: uniqueSubCat,
            Group_Head_Name: registeredGroupHeadName,
            Family_Member_Name: 'Batch Member',
            Client_Owner: 'Advisor B',
            Amounts: 75000,
            // Omitting New_Investments, Profit_Loss, XIRR
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/cashflows/import')
        .set('Cookie', staffCookie)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.count).toBe(2);
      if (Array.isArray(res.body.importedIds)) {
        createdCashflowIds.push(...res.body.importedIds);
      }

      const imported = await prisma.masterCashflow.findMany({
        where: { id: { in: res.body.importedIds } },
        orderBy: { srNo: 'asc' },
      });

      expect(imported.length).toBe(2);
      // Row 1: Purchase 75000 -> Outflow is -75000
      expect(Number(imported[0].newInvestments)).toBe(-75000);
      expect(Number(imported[0].profitLoss)).toBe(0);
      expect(Number(imported[0].xirr)).toBe(0);

      // Row 2: Redemption 75000 -> Inflow is +75000
      expect(Number(imported[1].newInvestments)).toBe(75000);
      expect(Number(imported[1].profitLoss)).toBe(0);
    });

    it('should preserve custom Date_Of_Entry from spreadsheet import (matching DB File SL.xlsx)', async () => {
      const payload = {
        rows: [
          {
            Date_Of_Entry: '26-09-2025',
            Transaction_Date: '04-04-2018',
            Transaction_Type: 'Redemption',
            Category: 'MF',
            Sub_Category: 'Historical Fund',
            Group_Head_Name: registeredGroupHeadName,
            Family_Member_Name: 'Member A',
            Client_Owner: 'RM Owner',
            Amounts: 50000,
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/cashflows/import')
        .set('Cookie', staffCookie)
        .send(payload);

      expect(res.status).toBe(201);
      if (Array.isArray(res.body.importedIds)) {
        createdCashflowIds.push(...res.body.importedIds);
      }
      const imported = await prisma.masterCashflow.findUnique({
        where: { id: res.body.importedIds[0] },
      });
      expect(imported?.dateOfEntry).toBe('26-09-2025');
    });
  });
});
