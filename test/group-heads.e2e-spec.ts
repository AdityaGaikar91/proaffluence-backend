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

describe('Group-Head Masters (e2e)', () => {
  let app: INestApplication;
  let managerCookie: string;
  let staffCookie: string;
  let createdGroupHeadId: string;
  let addedMemberId: string;

  const seedUsers = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../prisma/seeds/users.json'), 'utf8'),
  );
  const managerUser =
    seedUsers.find((u: any) => u.role === 'manager') || seedUsers[0];
  const staffUser =
    seedUsers.find((u: any) => u.role === 'staff_entry') ||
    seedUsers[seedUsers.length - 1];

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
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    await app.init();

    // 1. Sign in as Manager
    const managerRes = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({
        email: managerUser.email,
        password: managerUser.password,
      })
      .expect(200);

    const mCookieHeader = managerRes.headers['set-cookie'];
    const mCookieStr = Array.isArray(mCookieHeader)
      ? mCookieHeader.join('; ')
      : mCookieHeader;
    const mMatch = mCookieStr.match(/proaffluence\.session_token=[^;]+/);
    expect(mMatch).not.toBeNull();
    managerCookie = mMatch![0];

    // 2. Sign in as Staff Entry
    const staffRes = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({
        email: staffUser.email,
        password: staffUser.password,
      })
      .expect(200);

    const sCookieHeader = staffRes.headers['set-cookie'];
    const sCookieStr = Array.isArray(sCookieHeader)
      ? sCookieHeader.join('; ')
      : sCookieHeader;
    const sMatch = sCookieStr.match(/proaffluence\.session_token=[^;]+/);
    expect(sMatch).not.toBeNull();
    staffCookie = sMatch![0];
  });

  afterAll(async () => {
    // Clean up created test group heads if any remain
    if (createdGroupHeadId) {
      await prisma.groupHead.deleteMany({
        where: { id: createdGroupHeadId },
      });
    }
    await app.close();
    await prisma.$disconnect();
  });

  describe('Unauthenticated Access Prevention', () => {
    it('should reject GET /api/v1/group-heads without authentication with 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/group-heads').expect(401);
    });

    it('should reject POST /api/v1/group-heads without authentication with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/group-heads')
        .send({ name: 'Unauthorized Corp' })
        .expect(401);
    });
  });

  describe('Categories Master Endpoint', () => {
    it('should return supported categories and sub-categories dictionary', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/group-heads/categories')
        .set('Cookie', staffCookie)
        .expect(200);

      expect(response.body).toHaveProperty('categories');
      expect(response.body).toHaveProperty('subCategories');
      expect(Array.isArray(response.body.categories)).toBe(true);
      expect(Array.isArray(response.body.subCategories)).toBe(true);
      expect(response.body.categories.some((c: any) => c.key === 'MF')).toBe(
        true,
      );
      expect(response.body.categories.some((c: any) => c.key === 'PMS')).toBe(
        true,
      );
      expect(
        response.body.subCategories.some((s: any) => s.key === 'HYBRID'),
      ).toBe(true);
    });
  });

  describe('List & Filter Group Heads', () => {
    it('should list group heads with pagination and summary metrics', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/group-heads?page=1&limit=10')
        .set('Cookie', staffCookie)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.meta).toHaveProperty('total');
      expect(response.body.meta).toHaveProperty('activeCount');
      expect(response.body.meta).toHaveProperty('totalAum');
    });

    it('should search group heads by name or custom ID', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/group-heads?search=ABC')
        .set('Cookie', staffCookie)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data[0].name).toContain('ABC');
    });

    it('should filter group heads by category', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/group-heads?category=PMS')
        .set('Cookie', staffCookie)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      response.body.data.forEach((head: any) => {
        expect(head.categories).toContain('PMS');
      });
    });
  });

  describe('RBAC: Write Operations Forbidden for Staff Entry', () => {
    it('should reject mandate creation by staff_entry with 403 Forbidden', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/group-heads')
        .set('Cookie', staffCookie)
        .send({
          name: 'Forbidden Test Office',
          email: 'forbidden@test.com',
          inceptionDate: '15-08-2022',
          pan: 'ABCDE9999F',
        })
        .expect(403);

      expect(response.body.message).toContain('Insufficient permissions');
    });
  });

  describe('Mandate Creation & Custom ID Generation (Manager)', () => {
    it('should reject creation with malformed PAN', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/group-heads')
        .set('Cookie', managerCookie)
        .send({
          name: 'Invalid PAN Trust',
          email: 'invalid.pan@test.com',
          inceptionDate: '15-08-2022',
          pan: 'INVALID_PAN',
        })
        .expect(400);
    });

    it('should reject creation with invalid inception date format', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/group-heads')
        .set('Cookie', managerCookie)
        .send({
          name: 'Invalid Date Trust',
          email: 'invalid.date@test.com',
          inceptionDate: '2022/08/15', // Must be dd-MM-yyyy
          pan: 'ABCDE1111F',
        })
        .expect(400);
    });

    it('should successfully register a new mandate with auto-sequenced customId and initial family member', async () => {
      const testName = `Kothari Wealth Management ${Date.now()}`;
      const response = await request(app.getHttpServer())
        .post('/api/v1/group-heads')
        .set('Cookie', managerCookie)
        .send({
          name: testName,
          contactPerson: 'Vikram Kothari',
          email: 'vikram.kothari@kothariwealth.in',
          secondaryEmail: 'accounts@kothariwealth.in',
          inceptionDate: '12-04-2023',
          pan: 'abckv1234m', // Should be normalized to uppercase
          status: 'Active',
          notes: 'Anchor HNI multi-asset mandate.',
          categories: ['MF', 'PMS'],
          familyMembers: ['Vikram Kothari', 'Meera Kothari'],
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      createdGroupHeadId = response.body.id;
      expect(response.body.customId).toMatch(/^GH-\d+$/);
      expect(response.body.pan).toBe('ABCKV1234M');
      expect(response.body.familyMembers).toEqual(
        expect.arrayContaining(['Vikram Kothari', 'Meera Kothari']),
      );
      expect(response.body.members.length).toBe(2);
    });

    it('should reject creation with duplicate entity name with 409 Conflict', async () => {
      const existing = await prisma.groupHead.findFirst();
      expect(existing).not.toBeNull();

      const response = await request(app.getHttpServer())
        .post('/api/v1/group-heads')
        .set('Cookie', managerCookie)
        .send({
          name: existing!.name,
          email: 'duplicate@test.com',
          inceptionDate: '10-01-2022',
          pan: 'ABCDE1234F',
        })
        .expect(409);

      expect(response.body.message).toContain('already exists');
    });
  });

  describe('Get Mandate Details (GET /:id)', () => {
    it('should fetch single mandate by UUID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/group-heads/${createdGroupHeadId}`)
        .set('Cookie', staffCookie)
        .expect(200);

      expect(response.body.id).toBe(createdGroupHeadId);
      expect(response.body).toHaveProperty('counts');
    });

    it('should fetch single mandate by custom ID (e.g. GH-0101)', async () => {
      const existing = await prisma.groupHead.findFirst();
      expect(existing).not.toBeNull();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/group-heads/${existing!.customId}`)
        .set('Cookie', staffCookie)
        .expect(200);

      expect(response.body.id).toBe(existing!.id);
      expect(response.body.customId).toBe(existing!.customId);
    });

    it('should return 404 for non-existent ID', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/group-heads/non-existent-uuid-12345')
        .set('Cookie', staffCookie)
        .expect(404);
    });
  });

  describe('Update Mandate Details (PATCH /:id)', () => {
    it('should update contact person, notes, and secondary email', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/group-heads/${createdGroupHeadId}`)
        .set('Cookie', managerCookie)
        .send({
          contactPerson: 'Vikram A. Kothari',
          notes: 'Updated portfolio notes following review.',
          secondaryEmail: 'finance@kothariwealth.in',
        })
        .expect(200);

      expect(response.body.contactPerson).toBe('Vikram A. Kothari');
      expect(response.body.notes).toBe(
        'Updated portfolio notes following review.',
      );
      expect(response.body.secondaryEmail).toBe('finance@kothariwealth.in');
    });
  });

  describe('Toggle Status (PATCH /:id/status)', () => {
    it('should toggle mandate status to Inactive', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/group-heads/${createdGroupHeadId}/status`)
        .set('Cookie', managerCookie)
        .send({ status: 'Inactive' })
        .expect(200);

      expect(response.body.status).toBe('Inactive');
    });

    it('should toggle mandate status back to Active', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/group-heads/${createdGroupHeadId}/status`)
        .set('Cookie', managerCookie)
        .send({ status: 'Active' })
        .expect(200);

      expect(response.body.status).toBe('Active');
    });
  });

  describe('Family Member Management', () => {
    it('should add a family member under the mandate', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/group-heads/${createdGroupHeadId}/family-members`)
        .set('Cookie', managerCookie)
        .send({
          name: 'Rohan Kothari',
          relationship: 'Son',
          pan: 'ABCDE5678F',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      addedMemberId = response.body.id;
      expect(response.body.name).toBe('Rohan Kothari');
      expect(response.body.relationship).toBe('Son');
    });

    it('should reject duplicate family member name under same mandate with 409', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/group-heads/${createdGroupHeadId}/family-members`)
        .set('Cookie', managerCookie)
        .send({
          name: 'Rohan Kothari',
          relationship: 'Son',
        })
        .expect(409);
    });

    it('should remove a family member from the mandate', async () => {
      const response = await request(app.getHttpServer())
        .delete(
          `/api/v1/group-heads/${createdGroupHeadId}/family-members/${addedMemberId}`,
        )
        .set('Cookie', managerCookie)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Delete Safety & Constraints', () => {
    it('should reject hard delete of a Group Head with linked transactions with 400 Bad Request', async () => {
      // Find a seeded group head with cashflows
      const seededHeadWithCashflows = await prisma.groupHead.findFirst({
        where: {
          cashflows: { some: {} },
        },
      });

      if (seededHeadWithCashflows) {
        const response = await request(app.getHttpServer())
          .delete(`/api/v1/group-heads/${seededHeadWithCashflows.id}`)
          .set('Cookie', managerCookie)
          .expect(400);

        expect(response.body.message).toContain('cashflow entries');
      }
    });

    it('should allow deletion of a clean mandate without cashflows', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/api/v1/group-heads/${createdGroupHeadId}`)
        .set('Cookie', managerCookie)
        .expect(200);

      expect(response.body.success).toBe(true);
      createdGroupHeadId = ''; // Mark cleaned up
    });
  });
});
