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

  const seedUsers = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../prisma/seeds/users.json'), 'utf8'),
  );
  const managerUser =
    seedUsers.find((u: any) => u.role === 'manager') || seedUsers[0];

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
});
