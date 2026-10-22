import { registerAs } from '@nestjs/config';

export const authConfig = registerAs('auth', () => ({
  secret: process.env.BETTER_AUTH_SECRET || '',
  url: process.env.BETTER_AUTH_URL || 'http://localhost:8002',
  cookieSameSite: (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none') || 'lax',
  sessionExpiresIn: parseInt(process.env.SESSION_EXPIRES_IN || '1800', 10),
  sessionUpdateAge: parseInt(process.env.SESSION_UPDATE_AGE || '300', 10),
  signinRateLimitMax: parseInt(process.env.SIGNIN_RATE_LIMIT_MAX || '5', 10),
  signinRateLimitWindow: parseInt(process.env.SIGNIN_RATE_LIMIT_WINDOW || '60', 10),
}));
