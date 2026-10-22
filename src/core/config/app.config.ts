import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8002', 10),
  frontendOrigins: (process.env.FRONTEND_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === 'true',
  swaggerEnabled:
    process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true',
}));
