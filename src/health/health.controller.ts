import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Redis from 'ioredis';
import { Public } from '../auth/decorators/public.decorator';
import { HealthResponseDto } from './dto/health-response.dto';
import { PrismaService } from '../core/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

const execFileAsync = promisify(execFile);

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Public liveness endpoint (process up)',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is operational',
    type: HealthResponseDto,
  })
  check(): HealthResponseDto {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description: 'Checks Postgres, Redis, LibreOffice, qpdf, and SMTP config',
  })
  async readiness() {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = { ok: true };
    } catch (err: any) {
      checks.postgres = { ok: false, detail: err?.message || 'unreachable' };
    }

    const redisHost = this.config.get<string>('REDIS_HOST', '127.0.0.1');
    const redisPort = this.config.get<number>('REDIS_PORT', 6379);
    try {
      const redis = new Redis({
        host: redisHost,
        port: redisPort,
        password: this.config.get<string>('REDIS_PASSWORD') || undefined,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
      await redis.connect();
      const pong = await redis.ping();
      await redis.quit();
      checks.redis = { ok: pong === 'PONG' };
    } catch (err: any) {
      checks.redis = {
        ok: false,
        detail: err?.message || 'unreachable',
      };
    }

    try {
      const { stdout } = await execFileAsync('soffice', ['--version'], {
        timeout: 5000,
      });
      checks.libreoffice = { ok: true, detail: stdout.trim().slice(0, 80) };
    } catch (err: any) {
      checks.libreoffice = {
        ok: false,
        detail: err?.message || 'soffice not found',
      };
    }

    try {
      const { stdout } = await execFileAsync('qpdf', ['--version'], {
        timeout: 5000,
      });
      checks.qpdf = { ok: true, detail: stdout.trim().slice(0, 80) };
    } catch (err: any) {
      checks.qpdf = { ok: false, detail: err?.message || 'qpdf not found' };
    }

    const smtpHost = this.config.get<string>('SMTP_HOST');
    const smtpUser = this.config.get<string>('SMTP_USER');
    checks.smtpConfigured = {
      ok: Boolean(smtpHost && smtpUser),
      detail: smtpHost ? `host=${smtpHost}` : 'SMTP_HOST unset',
    };

    const criticalOk = checks.postgres.ok;
    const status = criticalOk ? 'ready' : 'not_ready';

    return {
      status,
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
