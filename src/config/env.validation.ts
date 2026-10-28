import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsString, IsUrl, validateSync } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsString()
  DATABASE_URL!: string;

  @IsString()
  DIRECT_URL!: string;

  @IsString()
  CASHFREE_CLIENT_ID!: string;

  @IsString()
  CASHFREE_CLIENT_SECRET!: string;

  @IsString()
  CASHFREE_API_VERSION!: string;

  @IsUrl({ require_tld: false })
  CASHFREE_BASE_URL!: string;

  @IsString()
  CASHFREE_WEBHOOK_SECRET!: string;

  @IsNumber()
  PORT!: number;

  @IsEnum(Environment)
  NODE_ENV!: Environment;

  @IsString()
  FRONTEND_ORIGIN!: string;
}

export function validateEnvConfig(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors
      .map((error) => {
        const constraints = error.constraints ? Object.values(error.constraints).join(', ') : '';
        return `${error.property}: ${constraints}`;
      })
      .join('\n');

    throw new Error(`Environment validation failed:\n${errorMessages}`);
  }

  return validatedConfig;
}
