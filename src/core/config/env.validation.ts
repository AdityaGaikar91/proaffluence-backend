import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum SameSite {
  Lax = 'lax',
  Strict = 'strict',
  None = 'none',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @IsOptional()
  PORT: number = 8002;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  @MinLength(32, { message: 'BETTER_AUTH_SECRET must be at least 32 characters long' })
  BETTER_AUTH_SECRET: string;

  @IsString()
  BETTER_AUTH_URL: string;

  @IsString()
  FRONTEND_ORIGINS: string;

  @IsEnum(SameSite)
  @IsOptional()
  COOKIE_SAMESITE: SameSite = SameSite.Lax;

  @IsNumber()
  @Min(60)
  @IsOptional()
  SESSION_EXPIRES_IN: number = 1800; // 30 minutes in seconds

  @IsNumber()
  @Min(10)
  @IsOptional()
  SESSION_UPDATE_AGE: number = 300; // 5 minutes in seconds

  @IsNumber()
  @IsOptional()
  SIGNIN_RATE_LIMIT_MAX: number = 5;

  @IsNumber()
  @IsOptional()
  SIGNIN_RATE_LIMIT_WINDOW: number = 60;

  @IsBoolean()
  @IsOptional()
  TRUST_PROXY: boolean = false;

  @IsBoolean()
  @IsOptional()
  SWAGGER_ENABLED: boolean = true;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors
      .map((err) => Object.values(err.constraints || {}).join(', '))
      .join('; ');
    throw new Error(`Environment validation failed: ${messages}`);
  }

  return validatedConfig;
}
