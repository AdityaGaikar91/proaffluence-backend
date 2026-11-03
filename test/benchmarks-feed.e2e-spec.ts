import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import * as fs from 'fs';
import * as path from 'path';
import { BenchmarkCode, QuoteSource } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { auth } from '../src/auth/auth';
import { PrismaService } from '../src/core/prisma/prisma.service';
import {
  INDEX_FEED_PROVIDERS,
  IndexFeedProvider,
  ProviderFetchResult,
} from '../src/benchmarks/providers/index-feed.types';

// Far-future dates so tests never collide with real data.
const PERIOD = '31-12-2099';
const HARDCODED_FAKES = [41250.35, 26180.9, 38900.5, 85400.2];

class FakeProvider implements IndexFeedProvider {
  calls: Array<{ from: string; to: string }> = [];
  constructor(
    readonly name: string,
    private readonly codes: BenchmarkCode[],
    private readonly type: 'TRI' | 'PRICE',
    public result: () => ProviderFetchResult,
  ) {}
  supports(code: BenchmarkCode) {
    return this.codes.includes(code);
  }
  seriesType() {
    return this.type;
  }
  fetchRange(_c: BenchmarkCode, from: Date, to: Date) {
    this.calls.push({ from: from.toISOString(), to: to.toISOString() });
    return Promise.resolve(this.result());
  }
}

const fakeTri = new FakeProvider(
  'fake-tri',
  [BenchmarkCode.NIFTY_50_TRI],
  'TRI',
  () => ({
    ok: false,
    provider: 'fake-tri',
    reason: 'TRI endpoint requires login',
  }),
);
const fakePr = new FakeProvider(
  'fake-nse',
  [BenchmarkCode.NIFTY_50_PR],
  'PRICE',
  () => ({
    ok: true,
    provider: 'fake-nse',
    seriesType: 'PRICE',
    sourceUrl: 'https://example.test/nse',
    quotes: [
      { date: '29-12-2099', closingValue: 30000.5 },
      { date: '30-12-2099', closingValue: 30100.25 },
    ],
  }),
);
const fakeBse = new FakeProvider(
  'fake-bse',
  [BenchmarkCode.SENSEX, BenchmarkCode.BSE_500],
  'PRICE',
  () => ({
    ok: false,
    provider: 'fake-bse',
    reason: 'HTTP 403',
  }),
);

describe('Benchmark free-feed sync (scope point 6, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let managerCookie: string;
  let staffCookie: string;

  const seedUsers = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../prisma/seeds/users.json'), 'utf8'),
  );
  const managerUser =
    seedUsers.find((u: any) => u.role === 'manager') || seedUsers[0];
  const staffUser =
    seedUsers.find((u: any) => u.role === 'staff_entry') || seedUsers[3];

  const cleanup = () =>
    prisma.indicesDataRecord.deleteMany({
      where: { date: { endsWith: '-2099' } },
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(INDEX_FEED_PROVIDERS)
      .useValue([fakeTri, fakePr, fakeBse])
      .compile();

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
    prisma = app.get(PrismaService);

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
    await cleanup();
    await app.close();
  });

  beforeEach(async () => {
    await cleanup();
  });

  it('syncs only provider data, never hardcoded values, and reports unavailable indices', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/sync')
      .set('Cookie', managerCookie)
      .send({ periodDate: PERIOD })
      .expect(201);

    expect(res.body.periodDate).toBe(PERIOD);
    expect(res.body.status).toBe('partial');
    expect(res.body.syncedCount).toBe(1);
    expect(res.body).toHaveProperty('overview');
    const byCode = Object.fromEntries(
      res.body.results.map((r: any) => [r.indexCode, r]),
    );
    expect(byCode.NIFTY_50_PR).toMatchObject({
      status: 'synced',
      closingValue: 30100.25,
      actualTradingDate: '30-12-2099',
      seriesType: 'PRICE',
    });
    expect(byCode.NIFTY_50_TRI).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('login'),
    });
    expect(byCode.SENSEX.status).toBe('unavailable');
    expect(byCode.BSE_500.status).toBe('unavailable');
    expect(res.body.manualFallbackRequired.sort()).toEqual([
      'BSE_500',
      'NIFTY_50_TRI',
      'SENSEX',
    ]);

    const rows = await prisma.indicesDataRecord.findMany({
      where: { date: { endsWith: '-2099' } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      indexCode: 'NIFTY_50_PR',
      source: QuoteSource.FEED,
      date: PERIOD,
    });
    expect(rows[0].notes).toContain('PRICE series');
    expect(rows[0].notes).toContain('trading date 30-12-2099');
    for (const r of rows)
      expect(HARDCODED_FAKES).not.toContain(Number(r.closingValue));
    // Requested window ends on the period date
    expect(fakePr.calls.at(-1)?.to.slice(0, 10)).toBe('2099-12-31');
  });

  it('never overwrites a MANUAL row', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/manual')
      .set('Cookie', managerCookie)
      .send({ date: PERIOD, indexCode: 'NIFTY_50_PR', closingValue: 12345.67 })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/sync')
      .set('Cookie', managerCookie)
      .send({ periodDate: PERIOD, indexCode: 'NIFTY_50_PR' })
      .expect(201);
    expect(res.body.results[0].status).toBe('skipped_manual');
    const row = await prisma.indicesDataRecord.findUnique({
      where: { date_indexCode: { date: PERIOD, indexCode: 'NIFTY_50_PR' } },
    });
    expect(row?.source).toBe(QuoteSource.MANUAL);
    expect(Number(row?.closingValue)).toBe(12345.67);
  });

  it('updates an existing FEED row when the feed value differs, unchanged otherwise', async () => {
    await prisma.indicesDataRecord.create({
      data: {
        date: PERIOD,
        indexCode: 'NIFTY_50_PR',
        closingValue: 1,
        source: QuoteSource.FEED,
        updatedBy: 'test',
      },
    });
    const first = await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/sync')
      .set('Cookie', managerCookie)
      .send({ periodDate: PERIOD, indexCode: 'NIFTY_50_PR' })
      .expect(201);
    expect(first.body.results[0].status).toBe('synced');
    const second = await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/sync')
      .set('Cookie', managerCookie)
      .send({ periodDate: PERIOD, indexCode: 'NIFTY_50_PR' })
      .expect(201);
    expect(second.body.results[0].status).toBe('unchanged');
  });

  it('returns unavailable with reason and writes nothing when all providers fail', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/sync')
      .set('Cookie', managerCookie)
      .send({ periodDate: PERIOD, indexCode: 'NIFTY_50_TRI' })
      .expect(201);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.syncedCount).toBe(0);
    expect(res.body.results[0].reason).toBeTruthy();
    expect(
      await prisma.indicesDataRecord.count({
        where: { date: { endsWith: '-2099' } },
      }),
    ).toBe(0);
  });

  it('rejects an invalid periodDate', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/sync')
      .set('Cookie', managerCookie)
      .send({ periodDate: '31-02-2099' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/sync')
      .set('Cookie', managerCookie)
      .send({ periodDate: 'garbage' })
      .expect(400);
  });

  it('defaults to the last completed month-end (computed, not hardcoded)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/sync')
      .set('Cookie', managerCookie)
      .send({ indexCode: 'NIFTY_50_TRI' })
      .expect(201);
    const ist = new Date(Date.now() + 330 * 60000);
    const expected = new Date(
      Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 0),
    );
    const dd = String(expected.getUTCDate()).padStart(2, '0');
    const mm = String(expected.getUTCMonth() + 1).padStart(2, '0');
    expect(res.body.periodDate).toBe(
      `${dd}-${mm}-${expected.getUTCFullYear()}`,
    );
  });

  it('backfill upserts each trading-day level (manager only)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/backfill')
      .set('Cookie', staffCookie)
      .send({
        indexCode: 'NIFTY_50_PR',
        fromDate: '01-12-2099',
        toDate: PERIOD,
      })
      .expect(403);
    const res = await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/backfill')
      .set('Cookie', managerCookie)
      .send({
        indexCode: 'NIFTY_50_PR',
        fromDate: '01-12-2099',
        toDate: PERIOD,
      })
      .expect(201);
    expect(res.body).toMatchObject({
      status: 'synced',
      synced: 2,
      tradingDaysFound: 2,
    });
    const unavailable = await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/backfill')
      .set('Cookie', managerCookie)
      .send({ indexCode: 'SENSEX', fromDate: '01-12-2099', toDate: PERIOD })
      .expect(201);
    expect(unavailable.body.status).toBe('unavailable');
    await request(app.getHttpServer())
      .post('/api/v1/benchmarks/indices/backfill')
      .set('Cookie', managerCookie)
      .send({
        indexCode: 'NIFTY_50_PR',
        fromDate: PERIOD,
        toDate: '01-12-2099',
      })
      .expect(400);
  });
});
