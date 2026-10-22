import * as crypto from 'crypto';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { admin, openAPI } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { prisma } from '../core/prisma/prisma.service';

const isProduction = process.env.NODE_ENV === 'production';
const isSwaggerEnabled =
  !isProduction || process.env.SWAGGER_ENABLED === 'true';

const sessionExpiresIn = parseInt(process.env.SESSION_EXPIRES_IN || '1800', 10);
const sessionUpdateAge = parseInt(process.env.SESSION_UPDATE_AGE || '300', 10);
const signinRateLimitMax = parseInt(process.env.SIGNIN_RATE_LIMIT_MAX || '5', 10);
const signinRateLimitWindow = parseInt(
  process.env.SIGNIN_RATE_LIMIT_WINDOW || '60',
  10,
);

const trustedOrigins = (process.env.FRONTEND_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const sameSite = (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none') || 'lax';

const ac = createAccessControl({});

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:8002',
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET || '01234567890123456789012345678901',
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
    revokeSessionsOnPasswordReset: true,
  },
  session: {
    expiresIn: sessionExpiresIn,
    updateAge: sessionUpdateAge,
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          // Force idle timeout cap and prevent long-lived "remember me" behavior
          session.expiresAt = new Date(Date.now() + sessionExpiresIn * 1000);
        },
      },
    },
  },
  advanced: {
    generateId: () => crypto.randomUUID(),
    cookiePrefix: 'proaffluence',
    useSecureCookies: isProduction,
    defaultCookieAttributes: {
      httpOnly: true,
      secure: isProduction,
      sameSite,
      maxAge: sessionExpiresIn,
    },
  },
  trustedOrigins,
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': {
        window: signinRateLimitWindow,
        max: signinRateLimitMax,
      },
    },
  },
  plugins: [
    admin({
      defaultRole: 'staff_entry',
      adminRoles: ['super_admin'],
      roles: {
        super_admin: ac.newRole({}),
        staff_entry: ac.newRole({}),
      },
    }),
    ...(isSwaggerEnabled ? [openAPI()] : []),
  ],
});
