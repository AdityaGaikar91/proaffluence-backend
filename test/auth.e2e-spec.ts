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
    // Mount Better Auth handler before body parsing middleware
    app.use('/api/auth', toNodeHandler(auth));
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
});
