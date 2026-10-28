import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { PaymentsModule } from './payments/payments.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { HealthModule } from './health/health.module';
import { CashfreeModule } from './cashfree/cashfree.module';
import { CommonModule } from './common/common.module';
import { validateEnvConfig } from './config/env.validation';

@Module({
  imports: [
    // Environment configuration with validation
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvConfig,
      envFilePath: '.env',
    }),
    // Rate limiting - 60 requests per minute per IP by default
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 60,
      },
    ]),
    // Core modules
    PrismaModule,
    CommonModule,
    CashfreeModule,
    // Feature modules
    PaymentsModule,
    WebhooksModule,
    HealthModule,
  ],
  providers: [
    // Apply rate limiting globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
