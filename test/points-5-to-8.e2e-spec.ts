import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import { AppModule } from '../src/app.module';
import { auth } from '../src/auth/auth';

describe('Scope Points 5-8: Benchmarks, Hybrid O_Template Engine, PDF & Communications (e2e)', () => {
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

    app.use(express.json({ limit: '500kb' }));
    app.use(express.urlencoded({ extended: true, limit: '500kb' }));

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();

    const signInRes = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({
        email: managerUser.email,
        password: managerUser.password,
      });

    const setCookies = signInRes.headers['set-cookie'];
    managerCookie = Array.isArray(setCookies)
      ? setCookies.join('; ')
      : setCookies;

    const staffRes = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({
        email: staffUser.email,
        password: staffUser.password,
      });

    const staffCookies = staffRes.headers['set-cookie'];
    staffCookie = Array.isArray(staffCookies)
      ? staffCookies.join('; ')
      : staffCookies;
  });

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // POINT 6: BENCHMARK AUTOMATION & HYBRID RULES
  // ===========================================================================
  describe('Point 6: Benchmarks & IndicesData (/api/v1/benchmarks)', () => {
    let manualRecordId: string;
    let customRuleId: string;

    it('GET /api/v1/benchmarks/indices returns 4 benchmarks, feed health, and indicesData', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/benchmarks/indices')
        .set('Cookie', managerCookie)
        .expect(200);

      expect(res.body).toHaveProperty('benchmarks');
      expect(res.body.benchmarks).toHaveProperty('NIFTY_50_TRI');
      expect(res.body.benchmarks).toHaveProperty('BSE_500');
      expect(res.body.benchmarks).toHaveProperty('SENSEX');
      expect(res.body).toHaveProperty('feedHealth');
      expect(Array.isArray(res.body.indicesData)).toBe(true);
    });

    it('POST /api/v1/benchmarks/indices/manual inserts a manual quote fallback', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/benchmarks/indices/manual')
        .set('Cookie', staffCookie)
        .send({
          date: '15-10-2026',
          indexCode: 'NIFTY_50_TRI',
          closingValue: 41890.25,
          notes: 'Manual NSE bulletin entry',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.date).toBe('15-10-2026');
      expect(res.body.closingValue).toBe(41890.25);
      expect(res.body.source).toBe('manual');
      manualRecordId = res.body.id;
    });

    it('POST /api/v1/benchmarks/indices/bulk ingests multiple benchmark records', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/benchmarks/indices/bulk')
        .set('Cookie', staffCookie)
        .send({
          records: [
            {
              date: '16-10-2026',
              indexCode: 'BSE_500',
              closingValue: 39100.5,
              notes: 'Bulk CSV line 1',
            },
            {
              date: '16-10-2026',
              indexCode: 'SENSEX',
              closingValue: 85900.0,
              notes: 'Bulk CSV line 2',
            },
          ],
        })
        .expect(201);

      expect(res.body.ingestedCount).toBe(2);
    });

    it('DELETE /api/v1/benchmarks/indices/:id removes a manual quote', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/benchmarks/indices/${manualRecordId}`)
        .set('Cookie', managerCookie)
        .expect(200);
    });

    it('GET /api/v1/benchmarks/hybrid-rules lists 50/50 and custom hybrid rules', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/benchmarks/hybrid-rules')
        .set('Cookie', staffCookie)
        .expect(200);

      expect(res.body.defaultEquityRatio).toBe(50);
      expect(res.body.defaultDebtRatio).toBe(50);
      expect(Array.isArray(res.body.rules)).toBe(true);
    });

    it('enforces RBAC on POST /api/v1/benchmarks/hybrid-rules (403 for staff, 201 for manager)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/benchmarks/hybrid-rules')
        .set('Cookie', staffCookie)
        .send({
          schemeName: 'Test Unauthorized Hybrid Fund',
          equityRatio: 65,
        })
        .expect(403);

      const res = await request(app.getHttpServer())
        .post('/api/v1/benchmarks/hybrid-rules')
        .set('Cookie', managerCookie)
        .send({
          schemeName: `Tata Balanced Advantage Fund ${Date.now()}`,
          category: 'MF',
          equityRatio: 65,
          notes: 'Custom 65/35 equity/debt split',
        })
        .expect(201);

      expect(res.body.equityRatio).toBe(65);
      expect(res.body.debtRatio).toBe(35);
      expect(res.body.isCustom).toBe(true);
      customRuleId = res.body.id;
    });

    it('PATCH and DELETE /api/v1/benchmarks/hybrid-rules/:id updates and deletes custom rule', async () => {
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/v1/benchmarks/hybrid-rules/${customRuleId}`)
        .set('Cookie', managerCookie)
        .send({ equityRatio: 50, notes: 'Reset to 50/50' })
        .expect(200);

      expect(patchRes.body.equityRatio).toBe(50);
      expect(patchRes.body.debtRatio).toBe(50);
      expect(patchRes.body.isCustom).toBe(false);

      await request(app.getHttpServer())
        .delete(`/api/v1/benchmarks/hybrid-rules/${customRuleId}`)
        .set('Cookie', managerCookie)
        .expect(200);
    });
  });

  // ===========================================================================
  // POINTS 5 & 7: HYBRID O_TEMPLATE CALCULATION ENGINE & PDF GENERATION
  // ===========================================================================
  describe('Points 5 & 7: Hybrid O_Template Calculation, Pre-Flight & PDF Engine (/api/v1/reports)', () => {
    it('GET /api/v1/reports/pre-flight returns readiness score and gate counts', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/pre-flight?period=30-09-2026&monthKey=2026-09')
        .set('Cookie', managerCookie)
        .expect(200);

      expect(res.body).toHaveProperty('readinessScore');
      expect(res.body).toHaveProperty('counts');
      expect(res.body.totalChecks).toBe(4);
    });

    it('enforces RBAC on freeze, unfreeze, and calculate endpoints (403 for staff_entry)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/reports/freeze')
        .set('Cookie', staffCookie)
        .send({ period: '30-09-2026' })
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/v1/reports/calculate')
        .set('Cookie', staffCookie)
        .send({ period: '30-09-2026' })
        .expect(403);
    });

    it('rejects calculate when period is not frozen', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/reports/unfreeze')
        .set('Cookie', managerCookie)
        .send({
          period: '30-09-2026',
          reason: 'Ensure unfrozen before calculate gate test.',
        });

      await request(app.getHttpServer())
        .post('/api/v1/reports/calculate')
        .set('Cookie', managerCookie)
        .send({ period: '30-09-2026', groupHeadId: 'abc' })
        .expect(409);
    });

    it('allows manager to freeze, execute O_Template calculation run, and unfreeze with audit reason', async () => {
      const freezeRes = await request(app.getHttpServer())
        .post('/api/v1/reports/freeze')
        .set('Cookie', managerCookie)
        .send({ period: '30-09-2026' })
        .expect(201);

      expect(freezeRes.body.isFrozen).toBe(true);
      expect(freezeRes.body.frozenPeriod).toBe('30-09-2026');

      const calcRes = await request(app.getHttpServer())
        .post('/api/v1/reports/calculate')
        .set('Cookie', managerCookie)
        .send({ period: '30-09-2026', groupHeadId: 'abc' })
        .expect(201);

      expect(calcRes.body.status).toBe('completed');
      expect(calcRes.body.summary).toHaveProperty('runId');
      expect(calcRes.body.stages).toHaveLength(5);

      const unfreezeRes = await request(app.getHttpServer())
        .post('/api/v1/reports/unfreeze')
        .set('Cookie', managerCookie)
        .send({
          period: '30-09-2026',
          reason: 'Re-opening period for E2E verification test.',
        })
        .expect(201);

      expect(unfreezeRes.body.isFrozen).toBe(false);
    });

    it('GET /api/v1/reports/annual-dashboard returns live dynamic shape by default; reference fixtures when USE_REFERENCE_DASHBOARD=true', async () => {
      // Default: dynamic path (no ABC/Dummy fixture short-circuit)
      const liveAbc = await request(app.getHttpServer())
        .get('/api/v1/reports/annual-dashboard?groupHeadId=abc&toPeriod=30-09-2026')
        .set('Cookie', managerCookie)
        .expect(200);

      expect(liveAbc.body).toHaveProperty('header');
      expect(liveAbc.body).toHaveProperty('summary');
      expect(Array.isArray(liveAbc.body.summary)).toBe(true);
      expect(liveAbc.body).toHaveProperty('xirr');
      expect(liveAbc.body).toHaveProperty('assetAllocation');

      // Optional layout-regression fixtures (env-gated)
      const prev = process.env.USE_REFERENCE_DASHBOARD;
      process.env.USE_REFERENCE_DASHBOARD = 'true';
      try {
        const abcRes = await request(app.getHttpServer())
          .get(
            '/api/v1/reports/annual-dashboard?groupHeadId=abc&toPeriod=30-09-2026',
          )
          .set('Cookie', managerCookie)
          .expect(200);

        expect(abcRes.body.portfolioReturns).toBe(11.74);
        const fy2627 = abcRes.body.summary.find(
          (r: any) => r.financialYear === 'FY 2026-27',
        );
        expect(fy2627.valueAsOn3103).toBe(17345177);
        expect(fy2627.newInvestments).toBe(-1327289);
        expect(fy2627.xirr).toBe(24.04);

        const dummyRes = await request(app.getHttpServer())
          .get(
            '/api/v1/reports/annual-dashboard?groupHeadId=Dummy&toPeriod=30-09-2026',
          )
          .set('Cookie', managerCookie)
          .expect(200);

        expect(dummyRes.body.portfolioReturns).toBe(16.55);
        expect(dummyRes.body.benchmark).toBe(9.36);
        const dummyFy2627 = dummyRes.body.summary.find(
          (r: any) => r.financialYear === 'FY 2026-27',
        );
        expect(dummyFy2627.valueAsOn3103).toBe(270954587);
        expect(dummyFy2627.xirr).toBe(22.28);
      } finally {
        if (prev === undefined) {
          delete process.env.USE_REFERENCE_DASHBOARD;
        } else {
          process.env.USE_REFERENCE_DASHBOARD = prev;
        }
      }
    });

    it('GET /api/v1/reports/template/abc downloads populated O_Template.xlsx binary', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/template/abc')
        .set('Cookie', managerCookie)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(1000);
    });

    it('GET /api/v1/reports/pdf/abc generates PAN-password-protected PDF (Page 1 only when no external PDFs uploaded)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/pdf/abc?encrypted=true')
        .set('Cookie', managerCookie)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['x-pdf-password-protected']).toBe('true');
      expect(res.headers['x-pdf-total-pages']).toBe('1');
      expect(res.body.length).toBeGreaterThan(500);
    });

    it('uploads external PDFs (MF_SUMMARY & STALLION_STATEMENT), merges them after Page 1 into Consolidated PDF, and supports deletion', async () => {
      // Create a 2-page synthetic MF Summary PDF and a 2-page synthetic Stallion PDF using pdf-lib
      const mfDoc = await PdfLibDocument.create();
      mfDoc.addPage();
      mfDoc.addPage();
      const mfBase64 = Buffer.from(await mfDoc.save()).toString('base64');

      const stallionDoc = await PdfLibDocument.create();
      stallionDoc.addPage();
      stallionDoc.addPage();
      const stallionBase64 = Buffer.from(await stallionDoc.save()).toString('base64');

      // 1. Upload MF_SUMMARY (2 pages)
      const upMfRes = await request(app.getHttpServer())
        .post('/api/v1/reports/external-pdfs/abc')
        .set('Cookie', staffCookie)
        .send({
          slot: 'MF_SUMMARY',
          period: '30-09-2026',
          filename: 'MF_Summary_ABC.pdf',
          base64Content: mfBase64,
        })
        .expect(201);

      expect(upMfRes.body.attachment.slot).toBe('MF_SUMMARY');
      expect(upMfRes.body.attachment.pageCount).toBe(2);
      expect(upMfRes.body.totalMergedPages).toBe(3); // 1 (Page 1) + 2

      // 2. Upload STALLION_STATEMENT (2 pages)
      const upStallionRes = await request(app.getHttpServer())
        .post('/api/v1/reports/external-pdfs/abc')
        .set('Cookie', staffCookie)
        .send({
          slot: 'STALLION_STATEMENT',
          period: '30-09-2026',
          filename: 'Stallion_Statement_ABC.pdf',
          base64Content: stallionBase64,
        })
        .expect(201);

      expect(upStallionRes.body.attachment.pageCount).toBe(2);
      expect(upStallionRes.body.totalMergedPages).toBe(5); // 1 (Page 1) + 2 (MF) + 2 (Stallion)

      // 3. Verify GET /api/v1/reports/consolidated reflects merged external PDFs and has no hardcoded constants
      const consRes = await request(app.getHttpServer())
        .get('/api/v1/reports/consolidated?groupHeadId=abc&toPeriod=30-09-2026')
        .set('Cookie', managerCookie)
        .expect(200);

      expect(consRes.body.totalMergedPages).toBe(5);
      expect(consRes.body.externalPdfs).toHaveLength(2);
      expect(consRes.body).not.toHaveProperty('mfSummary');
      expect(consRes.body).not.toHaveProperty('pmsReport');

      // 4. Stream unencrypted merged PDF and verify with pdf-lib that it has 5 pages
      const mergedPdfRes = await request(app.getHttpServer())
        .get('/api/v1/reports/pdf/abc?period=30-09-2026&encrypted=false')
        .set('Cookie', managerCookie)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(mergedPdfRes.headers['x-pdf-total-pages']).toBe('5');
      expect(mergedPdfRes.headers['x-pdf-external-count']).toBe('2');
      const loadedMerged = await PdfLibDocument.load(mergedPdfRes.body, {
        ignoreEncryption: true,
      });
      expect(loadedMerged.getPageCount()).toBe(5);

      // 4b. Encrypted client PDF is fail-closed: LibreOffice (+ qpdf for merges) required
      const encryptedMerged = await request(app.getHttpServer())
        .get('/api/v1/reports/pdf/abc?period=30-09-2026&encrypted=true')
        .set('Cookie', managerCookie);
      if (encryptedMerged.status === 503) {
        expect(encryptedMerged.body.message || encryptedMerged.text).toMatch(
          /qpdf|LibreOffice|soffice|fail-closed/i,
        );
      } else {
        expect(encryptedMerged.status).toBe(200);
        expect(encryptedMerged.headers['x-pdf-password-protected']).toBe('true');
      }

      // 5. Delete both external PDFs and verify page count returns to 1
      await request(app.getHttpServer())
        .delete(`/api/v1/reports/external-pdfs/abc/${upMfRes.body.attachment.id}?period=30-09-2026`)
        .set('Cookie', staffCookie)
        .expect(200);

      const del2Res = await request(app.getHttpServer())
        .delete(`/api/v1/reports/external-pdfs/abc/${upStallionRes.body.attachment.id}?period=30-09-2026`)
        .set('Cookie', staffCookie)
        .expect(200);

      expect(del2Res.body.totalMergedPages).toBe(1);
      expect(del2Res.body.externalPdfs).toHaveLength(0);
    });
  });

  // ===========================================================================
  // POINT 8: EMAIL DESIGN, APPROVAL & SENDING HUB
  // ===========================================================================
  describe('Point 8: Email Preview, Maker-Checker Approval & Dispatch (/api/v1/communications)', () => {
    it('GET /api/v1/communications/campaigns returns group head campaigns and provider status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/communications/campaigns')
        .set('Cookie', staffCookie)
        .expect(200);

      expect(Array.isArray(res.body.campaigns)).toBe(true);
      expect(Array.isArray(res.body.deliveryLogs)).toBe(true);
      expect(res.body.provider).toHaveProperty('dailyQuota');
    });

    it('enforces Maker-Checker workflow: staff marks ready -> staff blocked from approve/send -> manager approves & dispatches', async () => {
      // Find a valid active group head with email
      const listRes = await request(app.getHttpServer())
        .get('/api/v1/communications/campaigns')
        .set('Cookie', staffCookie)
        .expect(200);

      const eligibleRow = listRes.body.rows.find(
        (r: any) => !r.missingEmail,
      );
      expect(eligibleRow).toBeDefined();
      const targetId = eligibleRow.id;

      // 1. Staff marks targetId ready
      const readyRes = await request(app.getHttpServer())
        .post('/api/v1/communications/campaigns/mark-ready')
        .set('Cookie', staffCookie)
        .send({ groupHeadIds: [targetId] })
        .expect(201);

      expect(readyRes.body.updatedCount).toBe(1);

      // 2. Staff blocked from approving (403)
      await request(app.getHttpServer())
        .post('/api/v1/communications/campaigns/approve')
        .set('Cookie', staffCookie)
        .send({ groupHeadIds: [targetId] })
        .expect(403);

      // 3. Staff blocked from sending (403)
      await request(app.getHttpServer())
        .post('/api/v1/communications/send')
        .set('Cookie', staffCookie)
        .send({ groupHeadIds: [targetId] })
        .expect(403);

      // 4. Manager approves targetId
      const approveRes = await request(app.getHttpServer())
        .post('/api/v1/communications/campaigns/approve')
        .set('Cookie', managerCookie)
        .send({ groupHeadIds: [targetId] })
        .expect(201);

      expect(approveRes.body.approvedCount).toBe(1);

      // 5. Manager dispatches targetId with PAN-encrypted PDF attachment
      const sendRes = await request(app.getHttpServer())
        .post('/api/v1/communications/send')
        .set('Cookie', managerCookie)
        .send({ groupHeadIds: [targetId] })
        .expect(201);

      expect(sendRes.body.sentCount).toBe(1);
      expect(sendRes.body.dispatchedIds).toContain(targetId);
    });
  });
});
