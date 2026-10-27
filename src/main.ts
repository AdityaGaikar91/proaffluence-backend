import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';

import { AppModule } from './app.module';
import { auth } from './auth/auth';
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Disable default body parser as required by Better Auth
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 8002);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const trustProxy = configService.get<boolean>('TRUST_PROXY', false);
  const swaggerEnabled = configService.get<boolean>('SWAGGER_ENABLED', true);
  const frontendOrigins = (configService.get<string>('FRONTEND_ORIGINS', 'http://localhost:3000'))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  // Security headers with Helmet and disable X-Powered-By
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
    }),
  );

  // Trust proxy if configured
  if (trustProxy) {
    app.set('trust proxy', 1);
  }

  // CORS configuration
  app.enableCors({
    origin: frontendOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // Cookie parser
  app.use(cookieParser());

  const authHandler = toNodeHandler(auth);

  // Mount Better Auth handler BEFORE body parser middleware,
  // while allowing custom NestJS auth & password reset routes to pass through to NestJS
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

  // Mount standard body parsers with strict 100kb payload size limit
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // Global sanitized exception filter to prevent sensitive leakage
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // OpenAPI / Swagger Documentation
  if (nodeEnv !== 'production' || swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ProAffluence API')
      .setDescription(
        'ProAffluence Client Reporting Portal - Internal Staff Authentication & Services API',
      )
      .setVersion('1.0')
      .addCookieAuth('proaffluence.session_token', {
        type: 'apiKey',
        in: 'cookie',
        name: 'proaffluence.session_token',
        description: 'Better Auth HTTP-only session cookie',
      })
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    // Merge ONLY the required Better Auth endpoints into Swagger UI document
    if (auth.api && typeof auth.api.generateOpenAPISchema === 'function') {
      try {
        const authSchema = await auth.api.generateOpenAPISchema();
        const allowedAuthPaths = new Set([
          '/sign-in/email',
          '/sign-out',
          '/get-session',
        ]);

        if (authSchema?.paths) {
          for (const [path, methods] of Object.entries(authSchema.paths)) {
            if (!allowedAuthPaths.has(path)) {
              continue;
            }
            // Remove unsupported POST on /get-session (Better Auth requires deferSessionRefresh for POST)
            if (path === '/get-session' && (methods as any)?.post) {
              delete (methods as any).post;
            }
            for (const operation of Object.values(methods as Record<string, any>)) {
              if (operation && typeof operation === 'object') {
                operation.tags = ['Auth'];
              }
            }
            document.paths[`/api/auth${path}`] = methods as any;
          }
        }
        if (authSchema?.components?.schemas) {
          document.components = document.components || {};
          document.components.schemas = {
            ...document.components.schemas,
            ...authSchema.components.schemas,
          };
        }
      } catch (err: any) {
        logger.warn(`Could not merge Better Auth schema into Swagger: ${err.message}`);
      }
    }

    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
    SwaggerModule.setup('swagger', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });

    logger.log(`Swagger UI active at: http://localhost:${port}/docs (also at /swagger and /api/docs)`);
    logger.log(`Better Auth Reference UI active at: http://localhost:${port}/api/auth/reference`);
  }

  await app.listen(port);
  logger.log(`ProAffluence API server listening on http://localhost:${port}`);
}

bootstrap();
