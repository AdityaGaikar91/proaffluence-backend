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

describe('Auth & Session Management (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  const seedUsers = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../prisma/seeds/users.json'), 'utf8'),
  );
  const validAdmin = seedUsers.find((u: any) => u.role === 'super_admin') || seedUsers[0];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });

    app.use(cookieParser());
    const authHandler = toNodeHandler(auth);
    // Mount Better Auth handler while letting custom NestJS password reset routes pass through
    app.use('/api/auth', (req, res, next) => {
      if (
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
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('GET /health', () => {
    it('should be publicly accessible without authentication', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Public Sign-up Disabled', () => {
    it('should reject sign-up requests with error when sign-up is disabled', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({
          email: 'unauthorized_staff@proaffluence.com',
          name: 'Unauthorized User',
          password: 'Password123456!',
        });

      // Better Auth returns 403 or 400 when sign up is disabled
      expect([400, 403]).toContain(response.status);
    });
  });

  describe('Sign-in Credentials & Generic Errors', () => {
    it('should return a generic 401 when password is incorrect', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({
          email: validAdmin.email,
          password: 'IncorrectPassword123!',
        })
        .expect(401);

      expect(response.body.message).toBeDefined();
    });

    it('should return the same generic 401 when email does not exist (no enumeration)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({
          email: 'nonexistent.user@proaffluence.com',
          password: 'SomeRandomPassword123!',
        })
        .expect(401);

      expect(response.body.message).toBeDefined();
    });

    it('should successfully sign in with valid seeded credentials and set HttpOnly session cookie', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({
          email: validAdmin.email,
          password: validAdmin.password,
        })
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(validAdmin.email);

      // Verify Set-Cookie header
      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
      expect(cookieStr).toContain('proaffluence.session_token');
      expect(cookieStr.toLowerCase()).toContain('httponly');

      // Save cookie for subsequent authenticated tests
      const sessionCookieMatch = cookieStr.match(/proaffluence\.session_token=[^;]+/);
      expect(sessionCookieMatch).not.toBeNull();
      adminCookie = sessionCookieMatch![0];
    });
  });

  describe('GET /me (Session verification & Profile)', () => {
    it('should reject requests without a session cookie with 401', async () => {
      await request(app.getHttpServer())
        .get('/me')
        .expect(401);
    });

    it('should return authenticated user details and role with valid session cookie', async () => {
      const response = await request(app.getHttpServer())
        .get('/me')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(response.body).toMatchObject({
        email: validAdmin.email,
        name: validAdmin.name,
        role: 'super_admin',
      });
      expect(response.body.id).toBeDefined();
    });
  });

  describe('Sign-out & Session Revocation', () => {
    it('should invalidate session server-side and clear cookie on sign-out', async () => {
      const signoutResponse = await request(app.getHttpServer())
        .post('/api/auth/sign-out')
        .set('Cookie', adminCookie)
        .expect(200);

      // Cookie should be cleared or expired
      const setCookie = signoutResponse.headers['set-cookie'];
      if (setCookie) {
        const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
        expect(cookieStr).toContain('proaffluence.session_token');
      }

      // GET /me with the invalidated cookie should now return 401
      await request(app.getHttpServer())
        .get('/me')
        .set('Cookie', adminCookie)
        .expect(401);
    });
  });

  describe('Rate Limiting on Sign-in', () => {
    it('should trigger rate limit (429) after configured attempt threshold', async () => {
      const maxAttempts = parseInt(process.env.SIGNIN_RATE_LIMIT_MAX || '5', 10);
      let hitRateLimit = false;

      // Send rapid requests beyond maxAttempts
      for (let i = 0; i < maxAttempts + 3; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/sign-in/email')
          .set('X-Forwarded-For', '198.51.100.42')
          .send({
            email: 'rate-limit-test@proaffluence.com',
            password: 'BadPassword123!',
          });

        if (res.status === 429) {
          hitRateLimit = true;
          break;
        }
      }

      expect(hitRateLimit).toBe(true);
    });
  });

  describe('Password Reset Flow', () => {
    const testUser = seedUsers.find((u: any) => u.role === 'staff_entry') || seedUsers[1];
    let resetToken: string;

    it('should reject forgot-password with malformed email (class-validator)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('valid email address');
    });

    it('should return generic success on forgot-password for non-existent email (anti-enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'does-not-exist@proaffluence.com' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);
      expect(res.body.message).toContain('If this email exists in our system');
    });

    it('should process forgot-password for valid email and create verification token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({
          email: testUser.email,
          redirectTo: 'http://localhost:3000/reset-password',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);

      // Verify token exists in PostgreSQL database
      const dbUser = await prisma.user.findUnique({
        where: { email: testUser.email },
      });
      expect(dbUser).toBeDefined();

      const verification = await prisma.verification.findFirst({
        where: { value: dbUser!.id },
      });
      expect(verification).toBeDefined();
      expect(verification!.identifier).toMatch(/^reset-password:/);

      resetToken = verification!.identifier.replace('reset-password:', '');
      expect(resetToken.length).toBeGreaterThan(10);
    });

    it('should reject reset-password with password shorter than 8 chars (class-validator)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({
          token: resetToken,
          newPassword: 'short',
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('at least 8 characters');
    });

    it('should reject reset-password with an invalid token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({
          token: 'invalid-token-12345',
          newPassword: 'ValidNewPassword2026!',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid or expired password reset token');
    });

    it('should successfully reset password with valid token, consume token, and allow sign-in', async () => {
      const newPassword = 'BrandNewPassword2026!';

      const res = await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({
          token: resetToken,
          newPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);

      // Verify token is consumed (deleted)
      const consumed = await prisma.verification.findFirst({
        where: { identifier: `reset-password:${resetToken}` },
      });
      expect(consumed).toBeNull();

      // Attempting to reuse the same token should fail
      const reuseRes = await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({
          token: resetToken,
          newPassword: 'AnotherPassword2026!',
        });
      expect(reuseRes.status).toBe(400);

      // Sign-in with old password should fail
      const oldLoginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({
          email: testUser.email,
          password: testUser.password,
        });
      expect(oldLoginRes.status).toBe(401);

      // Sign-in with new password should succeed
      const newLoginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({
          email: testUser.email,
          password: newPassword,
        });
      expect(newLoginRes.status).toBe(200);
      expect(newLoginRes.headers['set-cookie']).toBeDefined();

      // Restore original password to keep test environment idempotent
      const ctx = await auth.$context;
      const originalHash = await ctx.password.hash(testUser.password);
      const dbUser = await prisma.user.findUnique({ where: { email: testUser.email } });
      await prisma.account.updateMany({
        where: { userId: dbUser!.id, providerId: 'credential' },
        data: { password: originalHash },
      });
    });
  });
});
