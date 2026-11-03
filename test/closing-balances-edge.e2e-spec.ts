/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * Edge-case E2E suite for Monthly Closing Balances.
 *
 * Isolation: all fixtures use a dedicated test Group Head and month keys in
 * year 2098 (never touched by seed data). Everything is removed in afterAll.
 *
 * Tests prefixed with "[BUG]" assert the behaviour required by
 * docs/REQUIREMENTS.md and are EXPECTED TO FAIL until the implementation is
 * fixed. They document real defects; do not "fix" them by weakening asserts.
 */
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
import { AllExceptionsFilter } from '../src/core/filters/all-exceptions.filter';

const BASE = '/api/v1/closing-balances';
const YEAR = '2098';
const mk = (m: number) => `${YEAR}-${String(m).padStart(2, '0')}`;
const STAMP = Date.now().toString(36).toUpperCase();
const GH_NAME = `ZZ CB Edge Test ${STAMP}`;
const GH_INACTIVE_NAME = `ZZ CB Edge Inactive ${STAMP}`;

describe('Monthly Closing Balances – edge cases (e2e)', () => {
  let app: INestApplication;
  let managerCookie: string;
  let staffCookie: string;
  let groupHeadId: string;
  let inactiveGroupHeadId: string;

  const seedUsers = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../prisma/seeds/users.json'), 'utf8'),
  );
  const managerUser = seedUsers.find((u: any) => u.role === 'manager');
  const staffUser = seedUsers.find((u: any) => u.role === 'staff_entry');

  const http = () => request(app.getHttpServer());

  const signIn = async (email: string, password: string) => {
    const res = await http()
      .post('/api/auth/sign-in/email')
      .send({ email, password });
    const c = res.headers['set-cookie'];
    return Array.isArray(c) ? c.join('; ') : c;
  };

  let srCounter = 0;
  const validBody = (overrides: Record<string, unknown> = {}) => ({
    Date_Of_Entry: '15-01-2098',
    Group_Head_Name: GH_NAME,
    Family_Member_Name: 'Edge Member A',
    Category: 'MF',
    Sub_Category: `Scheme ${STAMP} ${++srCounter}`,
    Closing_Amount: 1000,
    ...overrides,
  });

  const create = (overrides: Record<string, unknown> = {}) =>
    http().post(BASE).set('Cookie', managerCookie).send(validBody(overrides));

  const createOk = async (overrides: Record<string, unknown> = {}) => {
    const res = await create(overrides);
    if (res.status !== 201) {
      throw new Error(`fixture create failed ${res.status}: ${res.text}`);
    }
    return res.body;
  };

  const audits = (balanceId: string) =>
    prisma.auditTrail.findMany({
      where: { balanceId },
      orderBy: { timestamp: 'asc' },
    });

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
      if (req.path === '/me' || req.path.startsWith('/me?')) return next();
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
    // Mirror production (src/main.ts)
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    managerCookie = await signIn(managerUser.email, managerUser.password);
    staffCookie = await signIn(staffUser.email, staffUser.password);

    const gh = await prisma.groupHead.create({
      data: {
        customId: `GH-CBE-${STAMP}`,
        name: GH_NAME,
        email: 'cb-edge@example.com',
        inceptionDate: '01-04-2020',
        pan: 'ABCDE1234F',
        status: 'Active',
        familyMembers: { create: [{ name: 'Edge Member A' }] },
      },
    });
    groupHeadId = gh.id;
    const ghi = await prisma.groupHead.create({
      data: {
        customId: `GH-CBI-${STAMP}`,
        name: GH_INACTIVE_NAME,
        email: 'cb-edge-inactive@example.com',
        inceptionDate: '01-04-2020',
        pan: 'ZZZZZ9999Z',
        status: 'Inactive',
      },
    });
    inactiveGroupHeadId = ghi.id;
  });

  afterAll(async () => {
    await prisma.closingBalance.deleteMany({
      where: {
        OR: [
          { monthKey: { startsWith: `${YEAR}-` } },
          { groupHeadId: { in: [groupHeadId, inactiveGroupHeadId] } },
        ],
      },
    });
    await prisma.groupHead.deleteMany({
      where: { id: { in: [groupHeadId, inactiveGroupHeadId] } },
    });
    await app.close();
  });

  // ───────────────────────── Auth & RBAC ─────────────────────────
  describe('Authentication & RBAC', () => {
    const uuid = '00000000-0000-4000-8000-000000000000';
    const endpoints: [string, string][] = [
      ['get', BASE],
      ['get', `${BASE}/summary?monthKey=${mk(1)}`],
      ['post', `${BASE}/initialize-month`],
      ['patch', `${BASE}/batch`],
      ['post', BASE],
      ['post', `${BASE}/approve-month`],
      ['post', `${BASE}/bulk-approve`],
      ['post', `${BASE}/bulk-return`],
      ['get', `${BASE}/${uuid}`],
      ['post', `${BASE}/${uuid}/approve`],
      ['post', `${BASE}/${uuid}/return`],
    ];

    it.each(endpoints)('unauthenticated %s %s -> 401', async (m, url) => {
      await (http() as any)[m](url).send({}).expect(401);
    });

    it('garbage session cookie -> 401', async () => {
      await http()
        .get(BASE)
        .set('Cookie', 'proaffluence.session_token=garbage')
        .expect(401);
    });

    it('staff_entry can list and create', async () => {
      await http().get(BASE).set('Cookie', staffCookie).expect(200);
      await http()
        .post(BASE)
        .set('Cookie', staffCookie)
        .send(validBody({ Date_Of_Entry: '10-02-2098' }))
        .expect(201);
    });

    describe('[BUG] staff_entry must NOT perform manager actions (RBAC matrix)', () => {
      let id: string;
      beforeAll(async () => {
        id = (await createOk({ Date_Of_Entry: '10-02-2098' })).id;
      });

      it('[BUG] POST /:id/approve as staff -> 403', async () => {
        await http()
          .post(`${BASE}/${id}/approve`)
          .set('Cookie', staffCookie)
          .expect(403);
      });
      it('[BUG] POST /:id/return as staff -> 403', async () => {
        await http()
          .post(`${BASE}/${id}/return`)
          .set('Cookie', staffCookie)
          .send({ reason: 'x' })
          .expect(403);
      });
      it('[BUG] POST /bulk-approve as staff -> 403', async () => {
        await http()
          .post(`${BASE}/bulk-approve`)
          .set('Cookie', staffCookie)
          .send({ ids: [id] })
          .expect(403);
      });
      it('[BUG] POST /bulk-return as staff -> 403', async () => {
        await http()
          .post(`${BASE}/bulk-return`)
          .set('Cookie', staffCookie)
          .send({ ids: [id], reason: 'x' })
          .expect(403);
      });
      it('[BUG] POST /approve-month as staff -> 403', async () => {
        await http()
          .post(`${BASE}/approve-month`)
          .set('Cookie', staffCookie)
          .send({ monthKey: mk(2) })
          .expect(403);
      });
    });
  });

  // ───────────────────────── Create ─────────────────────────
  describe('POST / (create)', () => {
    it('happy path: derives monthKey + label, PENDING, CREATED audit', async () => {
      const res = await create({ Date_Of_Entry: '31-03-2098' }).expect(201);
      expect(res.body.monthKey).toBe(mk(3));
      expect(res.body.month).toBe('March 2098');
      expect(res.body.approvalStatus).toBe('PENDING');
      expect(res.body.groupHeadId).toBe(groupHeadId);
      expect(Number(res.body.closingAmount)).toBe(1000);
      const a = await audits(res.body.id);
      expect(a).toHaveLength(1);
      expect(a[0].action).toBe('CREATED');
    });

    it.each([
      'Date_Of_Entry',
      'Group_Head_Name',
      'Family_Member_Name',
      'Category',
      'Sub_Category',
    ])('missing required field %s -> 400', async (field) => {
      const body: any = validBody();
      delete body[field];
      await http()
        .post(BASE)
        .set('Cookie', managerCookie)
        .send(body)
        .expect(400);
    });

    it('invalid Category -> 400', async () => {
      await create({ Category: 'CRYPTO' }).expect(400);
    });

    it('lowercase / mixed-case category accepted (transform)', async () => {
      const res = await create({ Category: 'pms' }).expect(201);
      expect(res.body.category).toBe('PMS');
    });

    it('unknown group head -> 400', async () => {
      const res = await create({ Group_Head_Name: 'No Such Head XYZ' }).expect(
        400,
      );
      expect(res.body.message).toContain('not found');
    });

    it('case-insensitive + padded group head match', async () => {
      const res = await create({
        Group_Head_Name: `  ${GH_NAME.toUpperCase()}  `,
      }).expect(201);
      expect(res.body.groupHeadName).toBe(GH_NAME);
    });

    it('empty family member -> 400', async () => {
      await create({ Family_Member_Name: '' }).expect(400);
    });

    it('[BUG] whitespace-only family member -> 400', async () => {
      await create({ Family_Member_Name: '   ' }).expect(400);
    });

    it('[BUG] whitespace-only Sub_Category -> 400', async () => {
      await create({ Sub_Category: '   ' }).expect(400);
    });

    it('new family member is auto-created under the group head', async () => {
      const name = `New Member ${STAMP}`;
      const res = await create({ Family_Member_Name: name }).expect(201);
      const fm = await prisma.familyMember.findFirst({
        where: { groupHeadId, name },
      });
      expect(fm).not.toBeNull();
      expect(res.body.familyMemberId).toBe(fm!.id);
    });

    it('existing family member matched case-insensitively (no duplicate)', async () => {
      await create({ Family_Member_Name: 'edge member a' }).expect(201);
      const count = await prisma.familyMember.count({
        where: {
          groupHeadId,
          name: { equals: 'Edge Member A', mode: 'insensitive' },
        },
      });
      expect(count).toBe(1);
    });

    it('omitted Closing_Amount -> stored as null (missing)', async () => {
      const res = await create({ Closing_Amount: undefined }).expect(201);
      expect(res.body.closingAmount).toBeNull();
    });

    it('null Closing_Amount -> stored as null', async () => {
      const res = await create({ Closing_Amount: null }).expect(201);
      expect(res.body.closingAmount).toBeNull();
    });

    it('zero Closing_Amount -> stored as 0 (not missing)', async () => {
      const res = await create({ Closing_Amount: 0 }).expect(201);
      expect(Number(res.body.closingAmount)).toBe(0);
    });

    it('[BUG] negative Closing_Amount -> 400', async () => {
      await create({ Closing_Amount: -500 }).expect(400);
    });

    it('numeric string Closing_Amount is coerced and accepted', async () => {
      const res = await create({ Closing_Amount: '1000' }).expect(201);
      expect(Number(res.body.closingAmount)).toBe(1000);
    });

    it('[BUG] amount beyond Decimal(18,2) -> 400 (not 500)', async () => {
      await create({ Closing_Amount: 1e20 }).expect(400);
    });

    it('more than 2 decimals is rounded to 2 dp on write (import parity)', async () => {
      const res = await create({ Closing_Amount: 1234.5678 }).expect(201);
      expect(Number(res.body.closingAmount)).toBe(1234.57);
    });

    it.each(['2098-01-15', '15/01/2098', '1-1-2098', 'abc', ''])(
      'invalid Date_Of_Entry %p -> 400',
      async (d) => {
        await create({ Date_Of_Entry: d }).expect(400);
      },
    );

    it('[BUG] impossible calendar date 31-02-2098 / month 13 -> 400', async () => {
      await create({ Date_Of_Entry: '31-02-2098' }).expect(400);
      await create({ Date_Of_Entry: '15-13-2098' }).expect(400);
    });

    it('[BUG] monthKey inconsistent with Date_Of_Entry -> 400', async () => {
      await create({ Date_Of_Entry: '15-01-2098', monthKey: mk(5) }).expect(
        400,
      );
    });

    it('invalid monthKey format -> 400', async () => {
      await create({ monthKey: '2098-1' }).expect(400);
    });

    it('duplicate head+member+category+subCategory+month aggregates amounts (Excel sum)', async () => {
      const sub = `Dup Scheme ${STAMP}`;
      const first = await create({
        Sub_Category: sub,
        Closing_Amount: 1000,
      }).expect(201);
      const second = await create({
        Sub_Category: sub,
        Closing_Amount: 500,
      }).expect(201);
      expect(second.body.id).toBe(first.body.id);
      expect(Number(second.body.closingAmount)).toBe(1500);
    });

    it('Sr_No auto-increments across records', async () => {
      const a = await createOk();
      const b = await createOk();
      expect(b.srNo).toBeGreaterThan(a.srNo);
    });

    it('[BUG] explicit duplicate Sr_No is rejected', async () => {
      const a = await createOk();
      await create({ Sr_No: a.srNo }).expect(409);
    });

    it('Sr_No 0 / negative / float -> 400', async () => {
      await create({ Sr_No: 0 }).expect(400);
      await create({ Sr_No: -3 }).expect(400);
      await create({ Sr_No: 1.5 }).expect(400);
    });

    it('unknown property -> 400 (forbidNonWhitelisted)', async () => {
      await create({ approvalStatus: 'APPROVED' }).expect(400);
    });

    it('SQL-ish / XSS strings stored verbatim and safely', async () => {
      const evil = `'; DROP TABLE closing_balances; -- <script>alert(1)</script> ${STAMP}`;
      const res = await create({ Sub_Category: evil }).expect(201);
      expect(res.body.subCategory).toBe(evil);
      const n = await prisma.closingBalance.count();
      expect(n).toBeGreaterThan(0);
    });

    it('cannot create directly as APPROVED via smuggled field (whitelist)', async () => {
      await create({ approvedById: 'x' }).expect(400);
    });
  });

  // ───────────────────────── initialize-month ─────────────────────────
  describe('POST /initialize-month', () => {
    it.each(['2098', '2098-1', '98-01', 'abcd-ef', ''])(
      'invalid monthKey %p -> 400',
      async (m) => {
        await http()
          .post(`${BASE}/initialize-month`)
          .set('Cookie', managerCookie)
          .send({ monthKey: m })
          .expect(400);
      },
    );

    it('[BUG] month 13 / 00 -> 400', async () => {
      await http()
        .post(`${BASE}/initialize-month`)
        .set('Cookie', managerCookie)
        .send({ monthKey: '2098-13' })
        .expect(400);
    });

    it('scaffolds rows (incl. test head), is idempotent, excludes inactive heads', async () => {
      const first = await http()
        .post(`${BASE}/initialize-month`)
        .set('Cookie', managerCookie)
        .send({ monthKey: mk(6) })
        .expect(200);
      expect(first.body.scaffoldedCount).toBeGreaterThan(0);
      expect(first.body.month).toBe('June 2098');

      const mine = await prisma.closingBalance.findMany({
        where: { monthKey: mk(6), groupHeadId },
      });
      // every family member × 7 standard canonical scenarios (MF: Equity/Debt/Hybrid, PMS: Equity/Debt/Hybrid, STOCKS: Equity)
      const members = await prisma.familyMember.count({
        where: { groupHeadId },
      });
      expect(mine).toHaveLength(members * 7);
      expect(mine.every((r) => r.closingAmount === null)).toBe(true);
      expect(mine.every((r) => r.dateOfEntry === '30-06-2098')).toBe(true);

      const inactive = await prisma.closingBalance.count({
        where: { monthKey: mk(6), groupHeadId: inactiveGroupHeadId },
      });
      expect(inactive).toBe(0);

      const second = await http()
        .post(`${BASE}/initialize-month`)
        .set('Cookie', managerCookie)
        .send({ monthKey: mk(6) })
        .expect(200);
      expect(second.body.scaffoldedCount).toBe(0);
      expect(second.body.totalRows).toBe(first.body.totalRows);
    });

    it('[GAP] initialize-month writes no audit trail rows', async () => {
      const rows = await prisma.closingBalance.findMany({
        where: { monthKey: mk(6), groupHeadId },
        select: { id: true },
      });
      const n = await prisma.auditTrail.count({
        where: { balanceId: { in: rows.map((r) => r.id) } },
      });
      expect(n).toBe(rows.length);
    });
  });

  // ───────────────────────── PATCH /batch ─────────────────────────
  describe('PATCH /batch', () => {
    const patch = (updates: unknown) =>
      http()
        .patch(`${BASE}/batch`)
        .set('Cookie', managerCookie)
        .send({ updates });

    it('empty map -> 0 updated (200)', async () => {
      const res = await patch({}).expect(200);
      expect(res.body.updatedCount).toBe(0);
    });

    it('missing updates / array -> 400', async () => {
      await http()
        .patch(`${BASE}/batch`)
        .set('Cookie', managerCookie)
        .send({})
        .expect(400);
    });

    it('unknown ids are silently skipped (no 500)', async () => {
      const res = await patch({
        '00000000-0000-4000-8000-000000000000': 5,
        'not-a-uuid': 7,
      }).expect(200);
      expect(res.body.updatedCount).toBe(0);
    });

    it('updates value, writes CORRECTED audit with from/to', async () => {
      const r = await createOk({ Date_Of_Entry: '01-07-2098' });
      const res = await patch({ [r.id]: 2500.5 }).expect(200);
      expect(res.body.updatedCount).toBe(1);
      const a = await audits(r.id);
      expect(a.map((x) => x.action)).toEqual(['CREATED', 'CORRECTED']);
      expect(a[1].changes).toEqual({
        closingAmount: { from: 1000, to: 2500.5 },
      });
    });

    it('same value -> no-op, no audit', async () => {
      const r = await createOk({ Date_Of_Entry: '01-07-2098' });
      const res = await patch({ [r.id]: 1000 }).expect(200);
      expect(res.body.updatedCount).toBe(0);
      expect(await audits(r.id)).toHaveLength(1);
    });

    it('null clears the amount', async () => {
      const r = await createOk({ Date_Of_Entry: '01-07-2098' });
      await patch({ [r.id]: null }).expect(200);
      const row = await prisma.closingBalance.findUnique({
        where: { id: r.id },
      });
      expect(row!.closingAmount).toBeNull();
    });

    it('[BUG] updating 0 -> null (or null -> 0) is detected as a change', async () => {
      const r = await createOk({
        Date_Of_Entry: '01-07-2098',
        Closing_Amount: 0,
      });
      const res = await patch({ [r.id]: null }).expect(200);
      expect(res.body.updatedCount).toBe(1);
      const row = await prisma.closingBalance.findUnique({
        where: { id: r.id },
      });
      expect(row!.closingAmount).toBeNull();
    });

    it('voided rows are skipped', async () => {
      const r = await createOk({ Date_Of_Entry: '01-07-2098' });
      await prisma.closingBalance.update({
        where: { id: r.id },
        data: { voided: true },
      });
      const res = await patch({ [r.id]: 42 }).expect(200);
      expect(res.body.updatedCount).toBe(0);
    });

    it('editing RETURNED row resets to PENDING and clears returnReason', async () => {
      const r = await createOk({ Date_Of_Entry: '01-07-2098' });
      await http()
        .post(`${BASE}/${r.id}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: 'wrong' })
        .expect(200);
      await patch({ [r.id]: 777 }).expect(200);
      const row = await prisma.closingBalance.findUnique({
        where: { id: r.id },
      });
      expect(row!.approvalStatus).toBe('PENDING');
      expect(row!.returnReason).toBeNull();
    });

    it('[BUG] APPROVED row: edit should be blocked OR approval stamps cleared', async () => {
      const r = await createOk({ Date_Of_Entry: '01-07-2098' });
      await http()
        .post(`${BASE}/${r.id}/approve`)
        .set('Cookie', managerCookie)
        .expect(200);
      const res = await patch({ [r.id]: 999 });
      const row = await prisma.closingBalance.findUnique({
        where: { id: r.id },
      });
      if (res.status === 200 && res.body.updatedCount === 1) {
        expect(row!.approvalStatus).toBe('PENDING');
        // stale approver stamps must not remain on a PENDING row
        expect(row!.approvedById).toBeNull();
        expect(row!.approvedAt).toBeNull();
      } else {
        expect(Number(row!.closingAmount)).toBe(1000);
      }
    });

    it.each([
      ['negative', -10],
      ['string', 'abc'],
      ['numeric string', '123'],
      ['boolean', true],
      ['object', { a: 1 }],
    ])(
      '[BUG] invalid value (%s) -> 400 (not silently coerced)',
      async (_l, v) => {
        const r = await createOk({ Date_Of_Entry: '01-07-2098' });
        await patch({ [r.id]: v }).expect(400);
        const row = await prisma.closingBalance.findUnique({
          where: { id: r.id },
        });
        expect(Number(row!.closingAmount)).toBe(1000);
      },
    );

    it('[BUG] partial failure is atomic: out-of-range value -> 4xx and no rows changed', async () => {
      const a = await createOk({ Date_Of_Entry: '01-07-2098' });
      const b = await createOk({ Date_Of_Entry: '01-07-2098' });
      const res = await patch({ [a.id]: 5, [b.id]: 1e20 });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      const rowA = await prisma.closingBalance.findUnique({
        where: { id: a.id },
      });
      expect(Number(rowA!.closingAmount)).toBe(1000);
    });

    it('large batch (150 rows) updates all', async () => {
      await http()
        .post(`${BASE}/initialize-month`)
        .set('Cookie', managerCookie)
        .send({ monthKey: mk(8) })
        .expect(200);
      const rows = await prisma.closingBalance.findMany({
        where: { monthKey: mk(8) },
        take: 150,
      });
      const updates = Object.fromEntries(rows.map((r, i) => [r.id, i + 1]));
      const res = await patch(updates).expect(200);
      expect(res.body.updatedCount).toBe(rows.length);
    }, 60000);
  });

  // ───────────────────────── single approve / return ─────────────────────────
  describe('POST /:id/approve and /:id/return', () => {
    it('non-existent uuid -> 404', async () => {
      await http()
        .post(`${BASE}/00000000-0000-4000-8000-000000000000/approve`)
        .set('Cookie', managerCookie)
        .expect(404);
      await http()
        .get(`${BASE}/00000000-0000-4000-8000-000000000000`)
        .set('Cookie', managerCookie)
        .expect(404);
    });

    it('malformed id -> 4xx (not 500)', async () => {
      const res = await http()
        .get(`${BASE}/not-a-uuid`)
        .set('Cookie', managerCookie);
      expect([400, 404]).toContain(res.status);
    });

    it('approve sets stamps, clears returnReason, one APPROVED audit', async () => {
      const r = await createOk({ Date_Of_Entry: '01-04-2098' });
      await http()
        .post(`${BASE}/${r.id}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: 'check' })
        .expect(200);
      const res = await http()
        .post(`${BASE}/${r.id}/approve`)
        .set('Cookie', managerCookie)
        .expect(200);
      expect(res.body.approvalStatus).toBe('APPROVED');
      expect(res.body.approvedById).toBeTruthy();
      expect(res.body.approvedAt).toBeTruthy();
      expect(res.body.returnReason).toBeNull();
      const a = await audits(r.id);
      expect(a.map((x) => x.action)).toEqual([
        'CREATED',
        'RETURNED',
        'APPROVED',
      ]);
    });

    it('voided -> 400 for approve and return', async () => {
      const r = await createOk({ Date_Of_Entry: '01-04-2098' });
      await prisma.closingBalance.update({
        where: { id: r.id },
        data: { voided: true },
      });
      await http()
        .post(`${BASE}/${r.id}/approve`)
        .set('Cookie', managerCookie)
        .expect(400);
      await http()
        .post(`${BASE}/${r.id}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: 'x' })
        .expect(400);
    });

    it('[BUG] approving an already APPROVED entry -> 400/409, no duplicate audit', async () => {
      const r = await createOk({ Date_Of_Entry: '01-04-2098' });
      await http()
        .post(`${BASE}/${r.id}/approve`)
        .set('Cookie', managerCookie)
        .expect(200);
      const res = await http()
        .post(`${BASE}/${r.id}/approve`)
        .set('Cookie', managerCookie);
      expect([400, 409]).toContain(res.status);
      const a = await audits(r.id);
      expect(a.filter((x) => x.action === 'APPROVED')).toHaveLength(1);
    });

    it('[BUG] approving an entry with null closingAmount -> 400 (zero-estimation)', async () => {
      const r = await createOk({
        Date_Of_Entry: '01-04-2098',
        Closing_Amount: null,
      });
      await http()
        .post(`${BASE}/${r.id}/approve`)
        .set('Cookie', managerCookie)
        .expect(400);
    });

    it('[BUG] returning an APPROVED entry should be blocked (or require explicit re-open)', async () => {
      const r = await createOk({ Date_Of_Entry: '01-04-2098' });
      await http()
        .post(`${BASE}/${r.id}/approve`)
        .set('Cookie', managerCookie)
        .expect(200);
      const res = await http()
        .post(`${BASE}/${r.id}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: 'late change' });
      expect([400, 409]).toContain(res.status);
    });

    it('return without reason / empty reason -> 400', async () => {
      const r = await createOk({ Date_Of_Entry: '01-04-2098' });
      await http()
        .post(`${BASE}/${r.id}/return`)
        .set('Cookie', managerCookie)
        .send({})
        .expect(400);
      await http()
        .post(`${BASE}/${r.id}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: '' })
        .expect(400);
    });

    it('[BUG] return with whitespace-only reason -> 400', async () => {
      const r = await createOk({ Date_Of_Entry: '01-04-2098' });
      await http()
        .post(`${BASE}/${r.id}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: '   ' })
        .expect(400);
    });

    it('GET /:id returns audit entries newest first', async () => {
      const r = await createOk({ Date_Of_Entry: '01-04-2098' });
      await http()
        .post(`${BASE}/${r.id}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: 'r1' })
        .expect(200);
      await http()
        .post(`${BASE}/${r.id}/approve`)
        .set('Cookie', managerCookie)
        .expect(200);
      const res = await http()
        .get(`${BASE}/${r.id}`)
        .set('Cookie', managerCookie)
        .expect(200);
      expect(res.body.auditEntries.map((x: any) => x.action)).toEqual([
        'APPROVED',
        'RETURNED',
        'CREATED',
      ]);
    });
  });

  // ───────────────────────── bulk approve / return ─────────────────────────
  describe('POST /bulk-approve and /bulk-return', () => {
    it('empty ids / non-array / non-string ids -> 400', async () => {
      for (const ids of [[], 'abc', [1, 2]]) {
        await http()
          .post(`${BASE}/bulk-approve`)
          .set('Cookie', managerCookie)
          .send({ ids })
          .expect(400);
      }
    });

    it('approves only PENDING non-voided rows; count is accurate', async () => {
      const p = await createOk({ Date_Of_Entry: '01-09-2098' });
      const v = await createOk({ Date_Of_Entry: '01-09-2098' });
      await prisma.closingBalance.update({
        where: { id: v.id },
        data: { voided: true },
      });
      const res = await http()
        .post(`${BASE}/bulk-approve`)
        .set('Cookie', managerCookie)
        .send({ ids: [p.id, p.id, v.id] })
        .expect(200);
      expect(res.body.approvedCount).toBe(1);
    });

    it('[BUG] nonexistent id in bulk-approve -> no 500 (FK on audit insert)', async () => {
      const p = await createOk({ Date_Of_Entry: '01-09-2098' });
      const res = await http()
        .post(`${BASE}/bulk-approve`)
        .set('Cookie', managerCookie)
        .send({ ids: [p.id, '00000000-0000-4000-8000-000000000000'] });
      expect(res.status).toBeLessThan(500);
    });

    it('[BUG] bulk-approve writes audit only for rows actually changed', async () => {
      const p = await createOk({ Date_Of_Entry: '01-09-2098' });
      const already = await createOk({ Date_Of_Entry: '01-09-2098' });
      const voided = await createOk({ Date_Of_Entry: '01-09-2098' });
      await http()
        .post(`${BASE}/${already.id}/approve`)
        .set('Cookie', managerCookie)
        .expect(200);
      await prisma.closingBalance.update({
        where: { id: voided.id },
        data: { voided: true },
      });
      await http()
        .post(`${BASE}/bulk-approve`)
        .set('Cookie', managerCookie)
        .send({ ids: [p.id, p.id, already.id, voided.id] })
        .expect(200);
      const count = (a: any[]) =>
        a.filter((x) => x.action === 'APPROVED').length;
      expect(count(await audits(p.id))).toBe(1);
      expect(count(await audits(already.id))).toBe(1);
      expect(count(await audits(voided.id))).toBe(0);
    });

    it('[BUG] bulk-approve must not approve rows with null closingAmount', async () => {
      const m = await createOk({
        Date_Of_Entry: '01-09-2098',
        Closing_Amount: null,
      });
      const res = await http()
        .post(`${BASE}/bulk-approve`)
        .set('Cookie', managerCookie)
        .send({ ids: [m.id] });
      const row = await prisma.closingBalance.findUnique({
        where: { id: m.id },
      });
      expect(row!.approvalStatus).not.toBe('APPROVED');
      expect(res.status).toBeLessThan(500);
    });

    it('bulk-return missing / blank reason -> 400', async () => {
      const p = await createOk({ Date_Of_Entry: '01-09-2098' });
      for (const body of [{ ids: [p.id] }, { ids: [p.id], reason: '   ' }]) {
        await http()
          .post(`${BASE}/bulk-return`)
          .set('Cookie', managerCookie)
          .send(body)
          .expect(400);
      }
    });

    it('bulk-return trims reason and returns rows', async () => {
      const p = await createOk({ Date_Of_Entry: '01-09-2098' });
      const res = await http()
        .post(`${BASE}/bulk-return`)
        .set('Cookie', managerCookie)
        .send({ ids: [p.id], reason: '  fix it  ' })
        .expect(200);
      expect(res.body.returnedCount).toBe(1);
      const row = await prisma.closingBalance.findUnique({
        where: { id: p.id },
      });
      expect(row!.returnReason).toBe('fix it');
    });

    it('[BUG] bulk-return writes one audit per changed row (duplicates/voided ignored)', async () => {
      const p = await createOk({ Date_Of_Entry: '01-09-2098' });
      const voided = await createOk({ Date_Of_Entry: '01-09-2098' });
      await prisma.closingBalance.update({
        where: { id: voided.id },
        data: { voided: true },
      });
      await http()
        .post(`${BASE}/bulk-return`)
        .set('Cookie', managerCookie)
        .send({ ids: [p.id, p.id, voided.id], reason: 'r' })
        .expect(200);
      const count = (a: any[]) =>
        a.filter((x) => x.action === 'RETURNED').length;
      expect(count(await audits(p.id))).toBe(1);
      expect(count(await audits(voided.id))).toBe(0);
    });

    it('[BUG] bulk-return of APPROVED rows should be blocked', async () => {
      const p = await createOk({ Date_Of_Entry: '01-09-2098' });
      await http()
        .post(`${BASE}/${p.id}/approve`)
        .set('Cookie', managerCookie)
        .expect(200);
      await http()
        .post(`${BASE}/bulk-return`)
        .set('Cookie', managerCookie)
        .send({ ids: [p.id], reason: 'r' });
      const row = await prisma.closingBalance.findUnique({
        where: { id: p.id },
      });
      expect(row!.approvalStatus).toBe('APPROVED');
    });

    it('[BUG] huge id list (2000 fake ids) does not 500', async () => {
      const ids = Array.from(
        { length: 2000 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      );
      const res = await http()
        .post(`${BASE}/bulk-approve`)
        .set('Cookie', managerCookie)
        .send({ ids });
      expect(res.status).toBeLessThan(500);
    }, 60000);
  });

  // ───────────────────────── approve-month ─────────────────────────
  describe('POST /approve-month', () => {
    const approveMonth = (body: string | object) =>
      http()
        .post(`${BASE}/approve-month`)
        .set('Cookie', managerCookie)
        .send(body);

    it.each(['2098', '2098-1', 'x', ''])(
      'invalid monthKey %p -> 400',
      async (m) => {
        await approveMonth({ monthKey: m }).expect(400);
      },
    );

    it('allowMissingOverride non-boolean -> 400', async () => {
      await approveMonth({
        monthKey: mk(10),
        allowMissingOverride: 'yes',
      }).expect(400);
    });

    it('month with no records -> 404', async () => {
      await approveMonth({ monthKey: mk(11) }).expect(404);
    });

    it('gate: missing values w/o override 400; override w/o reason 400; with reason 200', async () => {
      const filled = await createOk({ Date_Of_Entry: '05-10-2098' });
      const missing = await createOk({
        Date_Of_Entry: '05-10-2098',
        Closing_Amount: null,
      });
      const voided = await createOk({ Date_Of_Entry: '05-10-2098' });
      await prisma.closingBalance.update({
        where: { id: voided.id },
        data: { voided: true },
      });

      const r1 = await approveMonth({ monthKey: mk(10) }).expect(400);
      expect(r1.body.message).toContain('1 valuation(s) are missing');
      await approveMonth({
        monthKey: mk(10),
        allowMissingOverride: true,
      }).expect(400);
      await approveMonth({
        monthKey: mk(10),
        allowMissingOverride: true,
        overrideReason: '   ',
      }).expect(400);

      const ok = await approveMonth({
        monthKey: mk(10),
        allowMissingOverride: true,
        overrideReason: 'Custodian statement delayed',
      }).expect(200);
      expect(ok.body.overridden).toBe(true);
      expect(ok.body.missingCount).toBe(1);

      const fa = await audits(filled.id);
      expect(fa.at(-1)!.action).toBe('APPROVED');
      expect(fa.at(-1)!.reason).toContain('Custodian statement delayed');
      const vRow = await prisma.closingBalance.findUnique({
        where: { id: voided.id },
      });
      expect(vRow!.approvalStatus).toBe('PENDING');
      expect(
        (await audits(voided.id)).some((x) => x.action === 'APPROVED'),
      ).toBe(false);
      // record what happens to the null row (approved under override)
      const mRow = await prisma.closingBalance.findUnique({
        where: { id: missing.id },
      });
      expect(mRow!.approvalStatus).toBe('APPROVED');
    });

    it('repeat call is idempotent: approvedCount 0, no new audits', async () => {
      const before = await prisma.auditTrail.count({
        where: { balance: { monthKey: mk(10) } },
      });
      const res = await approveMonth({
        monthKey: mk(10),
        allowMissingOverride: true,
        overrideReason: 'again',
      }).expect(200);
      expect(res.body.approvedCount).toBe(0);
      const after = await prisma.auditTrail.count({
        where: { balance: { monthKey: mk(10) } },
      });
      expect(after).toBe(before);
    });

    it('fully-filled month approves without override; RETURNED rows are left alone', async () => {
      const a = await createOk({ Date_Of_Entry: '05-12-2098' });
      const ret = await createOk({ Date_Of_Entry: '05-12-2098' });
      await http()
        .post(`${BASE}/${ret.id}/return`)
        .set('Cookie', managerCookie)
        .send({ reason: 'x' })
        .expect(200);
      const res = await approveMonth({ monthKey: mk(12) }).expect(200);
      expect(res.body.approvedCount).toBe(1);
      expect(res.body.overridden).toBe(false);
      const row = await prisma.closingBalance.findUnique({
        where: { id: a.id },
      });
      expect(row!.approvalStatus).toBe('APPROVED');
      const r2 = await prisma.closingBalance.findUnique({
        where: { id: ret.id },
      });
      expect(r2!.approvalStatus).toBe('RETURNED');
    });
  });

  // ───────────────────────── list & summary ─────────────────────────
  describe('GET / and GET /summary', () => {
    const list = (qs: string) =>
      http().get(`${BASE}?${qs}`).set('Cookie', managerCookie);

    it.each([
      'page=0',
      'page=-1',
      'limit=0',
      'limit=101',
      'limit=-5',
      'page=abc',
      'sortOrder=up',
      'statusTab=MISSING',
      'statusTab=pending',
      'monthKey=2098-1',
    ])('invalid query %p -> 400', async (qs) => {
      await list(qs).expect(400);
    });

    it('invalid sortBy falls back to srNo (no 500)', async () => {
      const res = await list(`monthKey=${mk(9)}&sortBy=password;drop`).expect(
        200,
      );
      const sr = res.body.data.map((r: any) => r.srNo);
      expect(sr).toEqual([...sr].sort((x, y) => x - y));
    });

    it('page beyond range -> empty data, correct meta', async () => {
      const res = await list(`monthKey=${mk(9)}&page=9999&limit=10`).expect(
        200,
      );
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.page).toBe(9999);
    });

    it('counts, statusTab, category, search, groupHeadName filters', async () => {
      const m = mk(1);
      const all = await list(`monthKey=${m}&limit=100`).expect(200);
      expect(all.body.counts.all).toBe(all.body.meta.total);
      const pending = await list(
        `monthKey=${m}&statusTab=PENDING&limit=100`,
      ).expect(200);
      expect(
        pending.body.data.every((r: any) => r.approvalStatus === 'PENDING'),
      ).toBe(true);
      expect(pending.body.meta.total).toBe(all.body.counts.pending);

      const pms = await list(`monthKey=${m}&category=pms&limit=100`).expect(
        200,
      );
      expect(pms.body.data.length).toBeGreaterThan(0);
      expect(pms.body.data.every((r: any) => r.category === 'PMS')).toBe(true);

      const s = await list(
        `monthKey=${m}&search=${encodeURIComponent(GH_NAME.toLowerCase())}`,
      ).expect(200);
      expect(s.body.meta.total).toBe(all.body.meta.total);

      const g = await list(
        `groupHeadName=${encodeURIComponent(GH_NAME)}&monthKey=${m}`,
      ).expect(200);
      expect(g.body.data.every((r: any) => r.groupHeadId === groupHeadId)).toBe(
        true,
      );
    });

    it('[BUG] unknown category should 400 or return nothing (currently ignored -> returns all)', async () => {
      const m = mk(3);
      const all = await list(`monthKey=${m}`).expect(200);
      const res = await list(`monthKey=${m}&category=CRYPTO`);
      if (res.status === 200) {
        expect(res.body.meta.total).toBeLessThan(all.body.meta.total);
      } else {
        expect(res.status).toBe(400);
      }
    });

    it('[BUG] search with LIKE wildcards (%) does not match everything', async () => {
      const res = await list(`monthKey=${mk(1)}&search=%25`).expect(200);
      expect(res.body.meta.total).toBe(0);
    });

    it('summary: counts and AUM exact for an isolated month', async () => {
      const m = mk(4);
      // wipe and seed controlled data
      await prisma.closingBalance.deleteMany({ where: { monthKey: m } });
      const a = await createOk({
        Date_Of_Entry: '02-04-2098',
        Closing_Amount: 100.25,
      });
      await createOk({ Date_Of_Entry: '02-04-2098', Closing_Amount: 200 });
      await createOk({ Date_Of_Entry: '02-04-2098', Closing_Amount: null });
      const v = await createOk({
        Date_Of_Entry: '02-04-2098',
        Closing_Amount: 5000,
      });
      await prisma.closingBalance.update({
        where: { id: v.id },
        data: { voided: true },
      });
      await http()
        .post(`${BASE}/${a.id}/approve`)
        .set('Cookie', managerCookie)
        .expect(200);

      const res = await http()
        .get(`${BASE}/summary?monthKey=${m}`)
        .set('Cookie', managerCookie)
        .expect(200);
      expect(res.body).toMatchObject({
        monthKey: m,
        month: 'April 2098',
        totalRows: 3,
        filledCount: 2,
        missingCount: 1,
        pendingCount: 2,
        approvedCount: 1,
        returnedCount: 0,
        totalValuationAum: 300.25,
        hasMissing: true,
      });
      expect(res.body.missingSample).toHaveLength(1);
    });

    it('summary for nonexistent month -> zeros', async () => {
      const res = await http()
        .get(`${BASE}/summary?monthKey=${mk(11)}`)
        .set('Cookie', managerCookie)
        .expect(200);
      expect(res.body).toMatchObject({
        totalRows: 0,
        missingCount: 0,
        totalValuationAum: 0,
        hasMissing: false,
      });
    });

    it('[BUG] summary with malformed monthKey -> 400', async () => {
      await http()
        .get(`${BASE}/summary?monthKey=garbage`)
        .set('Cookie', managerCookie)
        .expect(400);
    });

    it('summary with repeated monthKey (array) does not 500', async () => {
      const res = await http()
        .get(`${BASE}/summary?monthKey=${mk(4)}&monthKey=${mk(5)}`)
        .set('Cookie', managerCookie);
      expect(res.status).toBeLessThan(500);
    });
  });
});
